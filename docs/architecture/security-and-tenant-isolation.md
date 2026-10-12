# Security and Tenant Isolation

## 1. Purpose

This document defines the security architecture for the Tally. It establishes how the platform protects tenant data, controls access to commercial operations, secures usage ingestion, and preserves the integrity of invoices and payment records.

Security must be enforced across the application, database, API, background workers, and external integrations.

The platform will remain a modular monolith with separately runnable API and worker processes. Security controls must not depend on splitting the system into microservices.

## 2. Security Objectives

The platform must guarantee the following:

1. **Tenant confidentiality:** One tenant cannot access another tenant's subscriptions, usage records, quotas, invoices, or payment information.
2. **Authorization integrity:** Every operation is permitted only when the authenticated identity has the required permission and resource access.
3. **Usage integrity:** Billable usage cannot be fabricated or altered by an untrusted client.
4. **Financial integrity:** Clients cannot directly determine invoice totals, payment outcomes, or financial adjustments.
5. **Credential protection:** Secrets, API keys, tokens, and provider credentials are protected against disclosure and misuse.
6. **Auditability:** Sensitive administrative and financial operations produce attributable audit records.
7. **Operational resilience:** Security controls remain effective during retries, worker failures, deployments, and recovery.

## 3. Threat Model

The security design assumes that attackers may:

- Authenticate as a legitimate customer and attempt to access another tenant's resources.
- Manipulate identifiers, request bodies, query parameters, or pagination.
- Submit duplicate, forged, delayed, or reordered usage events.
- Abuse API credentials or exploit excessive request rates.
- Forge payment-provider webhook requests.
- Exploit vulnerable dependencies, unsafe configuration, or compromised credentials.
- Trigger concurrent operations to bypass quota, subscription, or billing checks.
- Abuse platform-administrator privileges or compromised worker identities.

The system must also account for accidental cross-tenant access caused by application defects.

## 4. Trust Boundaries

The platform recognizes these trust boundaries:

| Boundary | Security requirement |
|---|---|
| Public client to API | Authenticate, validate, authorize, rate-limit |
| Tenant to tenant | Enforce ownership on every resource operation |
| API to PostgreSQL | Use restricted credentials and tenant-aware queries |
| API to worker | Use durable records and explicit processing permissions |
| Platform to payment provider | Authenticate outbound requests and verify inbound webhooks |
| Platform administrator to customer data | Apply elevated authorization and audit sensitive access |
| Deployment environment to application | Protect secrets and restrict network access |

Data received from a browser, customer integration, webhook, or job payload must not automatically be trusted.

## 5. Authentication

### 5.1 Identity Provider

Authentication must use the platform's configured identity and access management (IAM) integration.

Tally must not introduce an independent password store or a parallel authentication system unless a separately approved requirement justifies it.

The API must validate the configured authentication mechanism, including:

- Token signature or introspection result.
- Issuer and intended audience.
- Expiration and applicable time constraints.
- Required scopes or claims.
- The active status of the identity where supported by the authentication model.

An authenticated identity establishes who is making a request. It does not establish ownership of every resource identified in that request.

### 5.2 Service Identities

Background workers and trusted integrations must use dedicated service identities with narrowly scoped permissions.

Service identities must not reuse human administrator credentials. Their credentials must be rotatable and revocable.

## 6. Tenant Isolation

### 6.1 Tenant Context

Every tenant-owned operation must execute within an explicitly established tenant context.

The tenant context must be derived from trusted authentication claims, verified membership, or an authorized service identity. A tenant ID supplied in a URL, header, or request body is only a resource selector; it is never sufficient proof of access.

The application must verify that the authenticated principal is authorized to operate within the selected tenant.

### 6.2 Resource Authorization

Every operation involving a tenant-owned resource must validate tenant ownership.

This applies to:

- Subscriptions and subscription changes.
- Entitlements and quotas.
- Usage events and aggregates.
- Invoices, invoice lines, and credit notes.
- Payment attempts and payment records.
- API credentials and integration settings.
- Reports, exports, and administrative actions.

Database queries must include tenant constraints wherever applicable. Fetching a resource globally by ID and checking ownership later must not become the default pattern.

For example, prefer a tenant-scoped lookup equivalent to:

`WHERE tenant_id = :authorizedTenantId AND id = :resourceId`

A random or opaque resource ID does not replace authorization.

### 6.3 Database Design

Tenant-owned tables must include a tenant identifier where needed to enforce isolation and support efficient queries.

Use composite indexes and, where appropriate, composite foreign-key constraints to prevent relationships from connecting records belonging to different tenants.

Examples include:

- `(tenant_id, id)` for tenant-scoped resource lookup.
- `(tenant_id, occurred_at)` for usage history.
- `(tenant_id, status, created_at)` for billing queues or tenant lists.
- `(tenant_id, idempotency_key)` where idempotency is tenant-scoped.

Global reference data, such as platform-managed plan definitions, may be shared. Customer-owned records must remain tenant-scoped.

### 6.4 Row-Level Security

PostgreSQL Row-Level Security (RLS) may be enabled as an additional defense-in-depth control for sensitive tenant-owned tables.

If RLS is used:

1. Policies must enforce the authorized tenant context.
2. Tenant context must be set transactionally on the database connection.
3. Connection-pool state must be reset or safely overwritten before reuse.
4. Application database roles must not have privileges that bypass the intended policies.
5. Tests must cover missing context, invalid context, and connection reuse across tenants.

RLS does not replace application-level authorization. It supplements it.

## 7. Authorization Model

Authorization must combine permissions with tenant membership and resource-level access.

### 7.1 Customer Roles

Initial customer roles may include:

- **Tenant Owner:** Manages the tenant and its commercial relationship.
- **Tenant Administrator:** Manages authorized tenant settings, subscriptions, and integrations.
- **Billing Administrator:** Views invoices and manages permitted billing operations.
- **Developer or Integration:** Ingests usage and accesses explicitly granted integration resources.
- **Read-Only Member:** Views permitted resources without modifying them.

Exact role names and assignments may evolve, but permissions must remain explicit.

### 7.2 Platform Roles

Platform administrators require separate permissions from customer tenant roles.

Examples include:

- Platform support.
- Catalog management.
- Billing operations.
- Security administration.
- Platform super-administration.

Elevated privileges must not be granted implicitly to ordinary tenant administrators.

Sensitive cross-tenant support access must require a documented reason, be limited to the required scope, and be recorded in the audit log.

### 7.3 Permission Enforcement

The API must enforce authorization at the application service boundary, not merely hide unavailable actions in the frontend.

Permissions defined in the API specification—including `subscriptions:manage`, `usage:write`, `billing:manage`, `billing:refund`, `catalog:manage`, and `platform:admin`—must be checked consistently.

High-impact operations may require additional confirmation or approval rules.

## 8. API Security

### 8.1 Input Validation

All incoming requests must be validated against explicit schemas or DTOs.

The API must:

- Reject invalid types, malformed identifiers, and unsupported enum values.
- Enforce field length and numeric limits.
- Reject unknown fields on sensitive write operations where practical.
- Validate pagination limits and sorting fields.
- Normalize data consistently before processing.
- Prevent mass assignment by mapping permitted fields explicitly.

Validation must be enforced server-side even when the frontend performs equivalent checks.

### 8.2 Rate Limiting and Resource Limits

Apply configurable rate limits to authentication-sensitive operations, usage ingestion, public endpoints, and expensive reports.

Enforce limits on:

- Request body size.
- Batch usage-event count.
- Concurrent expensive operations.
- Query time and pagination size.
- Webhook payload size.
- Export size and processing duration.

Rate limits must be attributable to an appropriate combination of identity, tenant, credential, and source where suitable.

### 8.3 Transport Security

All production API and webhook traffic must use HTTPS.

TLS termination, certificate renewal, and secure internal communication must be configured through the deployment environment. Plaintext access must not be exposed publicly.

### 8.4 CORS and CSRF

Configure Cross-Origin Resource Sharing (CORS) to allow only approved application origins.

If browser authentication uses cookies, implement appropriate CSRF protections and cookie settings, including `Secure`, `HttpOnly`, and a suitable `SameSite` policy.

If authentication exclusively uses bearer tokens supplied through authorization headers, evaluate CSRF exposure according to the actual browser credential model rather than applying cookie-specific controls blindly.

### 8.5 Error Handling

External error responses must not expose:

- Database queries or schema internals.
- Stack traces.
- Secrets or tokens.
- Internal filesystem paths.
- Provider credentials.
- Cross-tenant resource existence.

Use consistent error responses with safe messages and correlation identifiers. Detailed diagnostics belong in access-controlled server logs.

## 9. Usage Ingestion Security

Usage ingestion is a financial trust boundary because accepted events may affect customer charges.

### 9.1 Trusted Event Sources

Usage events must be submitted by authenticated and authorized sources.

The ingestion service must determine the tenant from the authorized integration identity or verify that the supplied tenant matches that identity.

The system must not accept a client-supplied tenant ID as authoritative.

### 9.2 Billable Fields

The server must control billable interpretation, including:

- Meter definitions.
- Units and conversion rules.
- Pricing references.
- Billing periods.
- Aggregation rules.
- Currency and applicable pricing configuration.

Untrusted clients must not be able to submit arbitrary invoice amounts or overwrite finalized usage totals.

Where a trusted source reports a quantity, validate its type, range, unit, and relationship to the configured meter.

### 9.3 Idempotency and Replay Protection

Usage submissions must support stable event identifiers or equivalent idempotency controls.

Duplicate submissions must not silently create duplicate billable usage. Retries must preserve the original event identity.

The system must distinguish a legitimate retry from an attempt to reuse an existing event identifier with conflicting content. Conflicting reuse must be rejected and recorded for investigation.

Where event timestamps are accepted, validate permitted time windows and define how delayed events affect closed billing periods.

### 9.4 API Keys

Integration API keys must:

- Be generated using a cryptographically secure random source.
- Be displayed in full only when initially issued, where practical.
- Be stored as a secure verifier or hash rather than recoverable plaintext.
- Have explicit scopes and tenant association.
- Support revocation and rotation.
- Be excluded from logs, traces, and error messages.

High-privilege credentials must have short lifetimes or additional safeguards where operationally feasible.

## 10. Billing and Payment Security

### 10.1 Financial Authority

The backend is authoritative for invoice totals, taxes payment status, refunds, and financial adjustments.

Customer-facing APIs must not permit clients to set finalized invoice totals, mark invoices as paid, or fabricate provider transaction identifiers.

Issued invoices must remain immutable. Corrections must use explicit adjustments, credit notes, or other approved financial records.

### 10.2 Payment Provider Integration

Use a provider adapter for outbound payment operations. Provider credentials must remain server-side and must never be included in frontend bundles.

Persist payment attempts and provider references with appropriate access controls.

The platform must store only the payment information needed for billing and reconciliation. Avoid handling or retaining raw card details and never store card verification codes (CVV).

### 10.3 Webhook Verification

Every payment-provider webhook must pass the following controls before it can affect financial state:

1. Verify the provider's signature using the documented verification procedure.
2. Validate the timestamp or other replay-protection mechanism where supported.
3. Deduplicate using the provider's stable event identifier.
4. Persist the verified event in a durable inbox or equivalent record.
5. Acknowledge receipt according to the provider's delivery contract.
6. Process the event idempotently.
7. Verify that the event relates to the expected tenant, payment attempt, provider account, and amount.
8. Record invalid signatures, conflicting events, and unexpected transitions.

A webhook notification alone must not be treated as proof that the intended payment succeeded. Where the provider's protocol requires it, reconcile the notification against authoritative provider state.

Out-of-order events must not move a payment into an invalid state. Define permitted state transitions and reconciliation rules explicitly.

## 11. Secrets Management

Production secrets must be injected through an approved secret-management mechanism or protected deployment configuration.

Secrets include:

- Database credentials.
- IAM client secrets.
- Signing or encryption keys.
- Payment-provider API credentials.
- Webhook verification secrets.
- Integration credentials.

Requirements:

- Never commit secrets to source control.
- Never include production secrets in example configuration files.
- Separate development, testing, staging, and production credentials.
- Rotate credentials through a documented process.
- Restrict secret access to the services and operators that require it.
- Redact secrets from logs and diagnostic output.
- Maintain a revocation and incident-response procedure for compromised credentials.

Use distinct keys for distinct purposes rather than reusing one key for authentication, encryption, and webhook verification.

## 12. Encryption and Data Protection

### 12.1 In Transit

Use TLS for external communications and protect internal service connections according to the deployment threat model.

### 12.2 At Rest

Use encrypted storage for production database volumes, backups, and other persistent storage through the hosting platform or storage layer.

Highly sensitive credentials may require application-level encryption in addition to storage encryption.

Encryption keys must be managed separately from the encrypted data.

### 12.3 Data Minimization

Collect only the information necessary to provide usage metering, subscriptions, invoicing, payment processing, and required auditability.

Define retention and deletion policies for:

- Raw usage events.
- Aggregated usage.
- API access logs.
- Audit records.
- Payment-provider events.
- Invoices and financial records.
- Backups and exported reports.

Retention requirements must account for contractual, operational, and applicable legal obligations. Financial records subject to retention obligations must not be deleted simply because a user account is removed.

## 13. Audit Logging

Security-sensitive and financial actions must produce audit events.

At minimum, audit:

- Role and permission changes.
- API key creation, rotation, and revocation.
- Subscription changes with commercial impact.
- Manual usage corrections.
- Invoice issuance and adjustments.
- Payment reconciliation and refunds.
- Cross-tenant administrative access.
- Changes to plans, prices, meters, and billing rules.
- Security configuration changes.

Each event must capture:

- Actor identity and actor type.
- Tenant context.
- Action and target resource.
- Timestamp in UTC.
- Outcome.
- Correlation or request identifier.
- Reason or approval reference for sensitive operations.

Audit logs must not contain passwords, raw tokens, full API keys, payment credentials, or unnecessary personal data.

Application roles must not be able to silently rewrite or delete security audit history. Use restricted database permissions and, where required, a separate protected log destination.

## 14. Background Worker Security

Workers must follow the same tenant-isolation and authorization principles as API requests.

Requirements:

- Use separate worker database credentials where useful.
- Grant each worker role only the permissions it needs.
- Validate persisted job payloads before processing.
- Treat queue payloads and external event content as untrusted.
- Revalidate relevant resource state before high-impact actions.
- Make financial and usage-processing jobs idempotent.
- Avoid accepting arbitrary SQL, shell commands, or unrestricted URLs in job payloads.
- Record job failures without exposing credentials or sensitive payload contents.

For jobs originating from API requests, persist the validated tenant context and resource references. Do not treat a job's tenant ID alone as authorization.

Use a transactional outbox or equivalent durable handoff where a database change must reliably trigger background processing.

## 15. Network and Infrastructure Security

Production infrastructure must follow least privilege.

- PostgreSQL must not be publicly accessible unless an explicitly approved architecture requires it.
- Restrict inbound and outbound network traffic to necessary destinations.
- Separate production from development and testing environments.
- Run containers as non-root where feasible.
- Use minimal, maintained container images.
- Avoid privileged containers and unnecessary host mounts.
- Keep operating systems, base images, and dependencies patched.
- Do not expose debug endpoints, development servers, or database administration interfaces publicly.
- Restrict access to deployment credentials and production environments.

Outbound HTTP integrations must validate destination URLs and prevent server-side request forgery (SSRF). Block access to prohibited internal networks and cloud metadata endpoints where appropriate. Do not follow arbitrary redirects to untrusted destinations.

## 16. Dependency and Supply-Chain Security

The project must:

- Pin or constrain dependencies through its package manifests and lockfiles.
- Run automated dependency vulnerability checks.
- Review high-risk dependency updates.
- Scan production container images.
- Keep build credentials separate from runtime credentials.
- Protect the CI/CD pipeline and release permissions.
- Avoid executing untrusted build scripts with production secrets available.
- Record released artifact versions for traceability.

Security scanning is a detection control, not proof that an application is secure. Findings must be triaged based on exploitability and impact.

## 17. Security Monitoring and Incident Response

Monitor for:

- Repeated authorization failures.
- Cross-tenant access attempts.
- Invalid or repeated webhook signatures.
- Usage-event conflicts and abnormal ingestion patterns.
- Unusual API-key usage.
- Excessive administrative actions.
- Unexpected invoice or payment state transitions.
- Repeated rate-limit violations.
- Suspicious export or data-access activity.

Maintain an incident procedure that covers containment, credential revocation, evidence preservation, impact assessment, recovery, and required communications.

For a suspected tenant-isolation failure or financial-integrity incident, prioritize preventing further unauthorized access or incorrect billing before resuming normal processing.

## 18. Threats and Mitigations

| Threat | Primary mitigation |
|---|---|
| Insecure direct object reference | Tenant-scoped queries and resource authorization |
| Forged tenant identity | Derive tenant context from trusted identity and verified membership |
| Duplicate billable usage | Event identity, idempotency, and conflict detection |
| Forged payment webhook | Signature verification and replay protection |
| Forged payment state | Authoritative provider reconciliation and valid state transitions |
| Privilege escalation | Explicit permission checks and least-privilege roles |
| API abuse | Rate limits, payload limits, and monitoring |
| Secret leakage | Secret manager, redaction, rotation, and restricted access |
| Cross-tenant database query | Tenant-aware constraints, tests, and optional RLS |
| Worker misuse | Dedicated identities, validated jobs, and restricted permissions |
| SSRF | Destination validation, redirect controls, and network egress restrictions |
| Audit tampering | Restricted write paths and protected log storage |
| Dependency compromise | Lockfiles, vulnerability scanning, and controlled releases |

## 19. Security Testing

Security controls must be tested at unit, integration, and end-to-end levels.

### 19.1 Tenant Isolation Tests

Create at least two independent tenants and verify that one tenant cannot:

- Read another tenant's resources.
- Update or delete another tenant's resources.
- Access another tenant's invoices or payment attempts.
- Submit usage under another tenant's identity.
- Infer sensitive information through exports or pagination.
- Trigger background operations against another tenant's records.

Test both successful authorized access and denied cross-tenant access.

### 19.2 Financial Integrity Tests

Verify that:

- Client-supplied invoice totals are rejected or ignored.
- Invalid payment transitions are rejected.
- Duplicate webhooks do not duplicate financial effects.
- Forged webhook signatures cannot update payment state.
- Conflicting idempotency-key reuse is rejected.
- Concurrent quota and billing operations preserve database invariants.
- Issued invoices cannot be silently mutated.

### 19.3 Infrastructure and API Tests

Test authentication failures, expired or incorrectly scoped tokens, malformed input, rate limits, oversized payloads, unsafe redirects, and secret redaction.

Where RLS is enabled, verify policy enforcement and connection-pool isolation across transactions.

Automated security tests must run in CI for critical authorization and financial-integrity invariants.

## 20. Acceptance Criteria

This architecture is ready for implementation when:

- [ ] Every tenant-owned API operation enforces tenant-scoped authorization.
- [ ] Tenant identity is derived from trusted authentication or verified service context.
- [ ] Customer and platform permissions are explicitly separated.
- [ ] Usage ingestion is authenticated, validated, and idempotent.
- [ ] Payment webhooks are verified, deduplicated, and durably recorded.
- [ ] Clients cannot determine authoritative invoice totals or payment outcomes.
- [ ] Secrets are excluded from source control, logs, and client bundles.
- [ ] Sensitive administrative and financial actions generate audit records.
- [ ] Background workers enforce tenant boundaries and least privilege.
- [ ] Production traffic uses TLS and database access is restricted.
- [ ] Tenant-isolation and financial-integrity tests run in CI.
- [ ] Incident-response and credential-rotation procedures are documented.

## 21. Implementation Principles

1. Authorization must be enforced by backend services, not frontend visibility.
2. Tenant identifiers are selectors, not credentials.
3. The backend owns all authoritative billing and payment state.
4. Idempotency is required wherever retries can create financial or usage side effects.
5. Database constraints and transactions must enforce critical invariants where possible.
6. Defense in depth must not create a false sense of security or replace correct authorization.
7. Security controls must be centralized where practical, tested, and documented.
8. New modules and integrations must follow these requirements before being exposed in production.

These requirements establish the security baseline for the platform. Any exception must have an explicit rationale, an identified risk owner, and documented compensating controls.