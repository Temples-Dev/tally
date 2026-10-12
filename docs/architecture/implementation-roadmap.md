# Implementation Roadmap

## 1. Purpose

This document defines the phased implementation plan for the Tally.

The roadmap translates the architecture, domain model, database design, usage metering, subscriptions, quotas, billing, API, security, observability, testing, and deployment specifications into an executable development sequence.

The goal is to establish a reliable commercial platform incrementally without building every feature simultaneously or introducing infrastructure complexity before it is needed.

## 2. Implementation Objectives

The implementation must deliver:

- A secure multi-tenant foundation.
- A reliable subscription and entitlement model.
- Accurate and idempotent usage metering.
- Configurable quota enforcement.
- Correct billing calculations and immutable issued invoices.
- Secure payment-provider integration.
- Observable and recoverable background processing.
- A usable customer-facing frontend.
- Automated tests for critical financial and security invariants.
- Reproducible deployment and recovery procedures.

## 3. Technical Baseline

| Area | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | NestJS, TypeScript |
| Database | PostgreSQL |
| API | REST with OpenAPI |
| Backend tests | Jest, Supertest |
| Database integration tests | Testcontainers |
| Frontend tests | Vitest, React Testing Library |
| End-to-end tests | Playwright |
| Deployment | Docker and Docker Compose |
| Background processing | PostgreSQL-backed durable jobs |
| Identity | Existing platform IAM integration |
| Payments | Provider adapter with sandbox support |

The initial architecture is a modular monolith with separately runnable API and worker processes.

PostgreSQL is the authoritative store. The first implementation must avoid premature microservices, distributed messaging infrastructure, and independently deployed domain services.

## 4. Delivery Principles

### 4.1 Build in Dependency Order

Implement foundational capabilities before dependent features.

For example, invoice generation depends on reliable usage records, pricing rules, subscription state, and billing-period definitions. It must not be implemented as an isolated feature before those foundations exist.

### 4.2 Establish Invariants Early

Critical invariants must be implemented and tested from the beginning:

- Every tenant-owned resource has enforced tenant isolation.
- Duplicate usage submissions do not create duplicate billable effects.
- Quota enforcement follows explicitly defined concurrency semantics.
- Issued invoices cannot be silently modified.
- Payment state changes follow validated transitions.
- Background jobs are recoverable and idempotent.
- All financial calculations use exact arithmetic.

### 4.3 Deliver Vertical Slices

Each major milestone must deliver a working path through the necessary layers rather than completing every database table or backend module before beginning integration.

A milestone must include domain logic, persistence, API behavior, relevant UI, tests, and operational visibility.

### 4.4 Keep External Integrations Replaceable

IAM and payment providers must be accessed through clearly defined integration boundaries.

The core billing domain must not depend on a particular payment provider's internal data model.

## 5. Phase Overview

<text size="sm" color="secondary">Recommended sequence; estimates must be refined after the initial technical spike and team-capacity assessment.</text>

| Phase | Focus | Exit outcome |
|---|---|---|
| 0 | Repository and engineering foundation | Reproducible development environment |
| 1 | Tenant, identity, and domain foundation | Secure application skeleton |
| 2 | Plans, subscriptions, and entitlements | Commercial access rules work |
| 3 | Usage metering and aggregation | Reliable usage records |
| 4 | Quotas and enforcement | Limits are enforced consistently |
| 5 | Billing and invoicing | Correct invoices can be issued |
| 6 | Payment integration | Payment events are processed safely |
| 7 | Customer frontend and API completion | End-to-end customer workflows |
| 8 | Operational readiness and hardening | Production candidate |
| 9 | Controlled launch | Verified initial production release |

These phases may overlap when dependencies permit, but critical financial and authorization invariants must not be deferred.

## 6. Phase 0 — Repository and Engineering Foundation

### Objectives

Create a consistent development environment and automated quality baseline.

### Tasks

- Initialize the repository structure.
- Configure TypeScript and shared compiler settings.
- Create the NestJS API application.
- Create the React frontend application.
- Create the worker entry point.
- Configure Docker and Docker Compose.
- Provision local PostgreSQL.
- Configure environment-variable validation.
- Establish linting, formatting, and type checking.
- Configure Jest, Vitest, and the initial CI pipeline.
- Establish database migration tooling.
- Create health endpoints and structured logging.
- Add contribution and development documentation.

### Deliverables

- API starts locally.
- Frontend starts locally.
- Worker starts independently.
- PostgreSQL persists data across application restarts.
- Tests execute in CI.
- Environment configuration is documented.
- A new developer can run the application using the documented setup process.

### Exit Criteria

No business functionality must depend on manual, undocumented environment setup.

## 7. Phase 1 — Tenant, Identity, and Domain Foundation

### Objectives

Establish tenant isolation, identity integration, and the foundational domain model.

### Tasks

- Define tenant and membership entities.
- Integrate with the configured IAM provider.
- Implement authentication validation.
- Implement permission checks.
- Establish tenant-context resolution.
- Create tenant-scoped repository patterns.
- Add database constraints and indexes.
- Implement audit-event infrastructure.
- Define standard API errors.
- Establish request correlation IDs.
- Implement authorization test fixtures.

### Deliverables

- Authenticated requests resolve to an authorized tenant context.
- Customer and platform permissions are separated.
- Tenant-owned resources cannot be accessed across tenant boundaries.
- Sensitive operations produce audit records.
- Database migrations are reproducible.

### Exit Criteria

Automated cross-tenant access tests pass before commercial operations are introduced.

## 8. Phase 2 — Plans, Subscriptions, and Entitlements

### Objectives

Implement the commercial catalog and determine what each tenant is entitled to use.

### Tasks

- Implement plan and plan-version models.
- Define meters and entitlement definitions.
- Implement subscription lifecycle rules.
- Implement subscription changes and cancellation.
- Implement effective-dated plan assignments where required.
- Resolve entitlements from subscription state.
- Define behavior for expired, suspended, and cancelled subscriptions.
- Implement relevant API endpoints.
- Create initial frontend screens for plans and subscriptions.

### Deliverables

- Plans can be managed through authorized operations.
- Tenants can view their subscriptions.
- Subscription transitions follow documented rules.
- Entitlements can be resolved consistently.
- Plan changes have defined effective-date semantics.

### Exit Criteria

Subscription and entitlement tests cover valid transitions, invalid transitions, and billing-period boundaries.

## 9. Phase 3 — Usage Metering and Aggregation

### Objectives

Accept trustworthy usage events and produce reliable aggregates for billing and quota evaluation.

### Tasks

- Implement authenticated usage ingestion.
- Define event identifiers and idempotency rules.
- Validate meter definitions, units, quantities, and timestamps.
- Persist accepted and rejected events appropriately.
- Implement batch ingestion limits.
- Implement aggregation jobs.
- Define late-arriving event behavior.
- Implement source-to-aggregate reconciliation.
- Add ingestion and aggregation metrics.
- Implement retry-safe processing.

### Deliverables

- Authorized integrations can submit usage.
- Duplicate events do not produce duplicate billable effects.
- Invalid or conflicting events are rejected.
- Aggregates are traceable to accepted source events.
- Failed aggregation jobs can be recovered safely.

### Exit Criteria

Tests prove correctness under duplicate delivery, worker interruption, delayed events, and concurrent processing.

## 10. Phase 4 — Quotas and Enforcement

### Objectives

Apply plan entitlements and usage limits to customer operations.

### Tasks

- Implement quota definitions.
- Implement usage-counter persistence.
- Define enforcement semantics for concurrent requests.
- Implement pre-operation and post-operation usage recording where appropriate.
- Implement quota-period resets.
- Define behavior for exhausted, unlimited, and unconfigured quotas.
- Implement relevant API responses.
- Add quota observability and reconciliation.

### Deliverables

- Requests are evaluated against the correct entitlement and quota.
- Enforcement behavior is documented and consistent.
- Concurrent operations preserve the defined quota guarantees.
- Customers can inspect relevant usage and quota status.

### Exit Criteria

Boundary and concurrency tests establish that quota behavior matches the documented policy.

## 11. Phase 5 — Billing and Invoicing

### Objectives

Convert eligible usage and commercial rules into accurate, auditable invoices.

### Tasks

- Implement billing-period definitions.
- Implement pricing calculation.
- Define currency precision and rounding rules.
- Implement invoice and invoice-line models.
- Implement invoice-generation jobs.
- Ensure source usage and pricing versions are traceable.
- Implement invoice numbering and uniqueness rules.
- Implement invoice issuance.
- Implement credit notes and adjustment records.
- Implement billing APIs and initial invoice screens.
- Add reconciliation and billing-period monitoring.

### Deliverables

- Invoices can be generated from eligible usage.
- Invoice calculations are deterministic.
- Duplicate jobs do not issue duplicate invoices.
- Issued invoices remain immutable.
- Corrections produce explicit financial records.
- Invoice totals can be reconciled against their inputs.

### Exit Criteria

Financial calculation, concurrency, and recovery tests pass. Billing behavior must be explainable from persisted source records and applicable pricing rules.

## 12. Phase 6 — Payment Integration

### Objectives

Enable controlled payment initiation and secure processing of provider events.

### Tasks

- Define the payment-provider adapter interface.
- Implement the first selected provider.
- Configure sandbox credentials.
- Implement payment-attempt persistence.
- Implement outbound payment initiation.
- Implement signed webhook verification.
- Add durable webhook receipt and deduplication.
- Implement valid payment-state transitions.
- Implement reconciliation against provider records.
- Define refund handling where supported.
- Add provider-specific metrics and alerts.

### Deliverables

- Payment attempts can be initiated through the provider adapter.
- Verified provider events update payment state safely.
- Duplicate and out-of-order events do not produce invalid transitions.
- Payment discrepancies can be identified and reconciled.
- Provider secrets remain server-side.

### Exit Criteria

Payment tests cover invalid signatures, retries, duplicates, provider timeouts, and reconciliation discrepancies.

## 13. Phase 7 — Customer Frontend and API Completion

### Objectives

Deliver a coherent customer experience across the completed commercial workflows.

### Tasks

- Complete authentication and session integration.
- Implement the tenant overview.
- Implement plan and subscription views.
- Implement usage history and aggregate summaries.
- Implement quota and entitlement displays.
- Implement invoice lists and details.
- Implement payment status and permitted billing actions.
- Add loading, empty, error, and recovery states.
- Verify API error handling.
- Validate the OpenAPI contract.
- Add critical Playwright workflows.

### Deliverables

Customers can use the platform through a consistent interface without relying on direct database access or undocumented API calls.

### Exit Criteria

End-to-end tests demonstrate subscription management, usage visibility, invoice access, payment status handling, and tenant isolation.

## 14. Phase 8 — Operational Readiness and Hardening

### Objectives

Verify that the system can be deployed, monitored, secured, and recovered safely.

### Tasks

- Complete structured logging and metrics.
- Establish operational alerts.
- Review API and worker permissions.
- Review database roles and tenant-isolation controls.
- Verify secret handling and rotation.
- Run dependency and container scans.
- Perform database migration rehearsals.
- Test backup restoration.
- Document RPO and RTO.
- Write operational runbooks.
- Exercise worker recovery.
- Conduct load tests against expected workloads.
- Resolve critical security and financial-integrity findings.
- Validate staging deployment and rollback or forward-recovery procedures.

### Deliverables

- Actionable monitoring and alerts.
- Tested recovery procedures.
- Reproducible staging deployment.
- Documented operational responsibilities.
- Evidence that critical security and financial invariants hold.

### Exit Criteria

No unresolved critical tenant-isolation, authorization, data-integrity, or financial-integrity defects remain.

## 15. Phase 9 — Controlled Production Launch

### Objectives

Release the platform to an initial, controlled customer group.

### Tasks

- Verify production configuration and credentials.
- Confirm database backups and monitoring.
- Run final migration checks.
- Deploy the approved release artifacts.
- Verify API, frontend, and worker health.
- Test IAM integration.
- Verify payment-provider connectivity.
- Monitor usage ingestion and billing processing.
- Perform controlled end-to-end smoke tests without real customer charges.
- Review initial reconciliation results.
- Confirm support and incident-response ownership.

### Launch Strategy

Prefer a limited rollout before broad availability.

Observe real workload patterns, processing delays, support issues, and reconciliation results. Expand only after the system demonstrates stable operation.

### Exit Criteria

The release meets its agreed service objectives, critical workflows operate correctly, and the team can diagnose and recover from expected failures.

## 16. Cross-Cutting Engineering Requirements

These requirements apply throughout all phases.

### 16.1 Security

- Enforce tenant isolation at every resource boundary.
- Use least-privilege application and service identities.
- Protect secrets and sensitive financial information.
- Verify all external webhook signatures.
- Audit sensitive financial and administrative operations.

### 16.2 Data Integrity

- Use transactions for related state changes.
- Apply database constraints to critical invariants.
- Use stable idempotency keys for retryable operations.
- Preserve the immutability of issued invoices.
- Reconcile derived aggregates and payment records.

### 16.3 API Compatibility

- Treat OpenAPI as the authoritative API contract.
- Validate request and response schemas.
- Document permission requirements.
- Use explicit API versioning and compatibility policies.
- Avoid silently changing established client-facing semantics.

### 16.4 Operations

- Instrument API and worker processes.
- Monitor processing delays and failures.
- Keep durable job processing recoverable.
- Test backups and restoration.
- Maintain deployment and incident-response documentation.

## 17. Repository Structure

The repository must reflect the modular monolith while separating frontend, API, worker, and deployment concerns.

```text
/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   └── shared-contracts/
├── docs/
│   └── architecture/
├── infrastructure/
│   ├── docker/
│   └── deployment/
├── tests/
│   ├── integration/
│   └── e2e/
├── docker-compose.yml
├── package.json
└── README.md
```

Domain modules are organized as packages within the modular monolith; separate packages per domain are not mandatory. Domain modules must remain cohesive and must not introduce unnecessary build or dependency boundaries.

The exact directory layout may be adjusted to match the selected workspace tooling.

## 18. Definition of Done

A feature is complete only when all applicable requirements are satisfied:

- Domain behavior follows its specification.
- Authorization and tenant isolation are enforced.
- Persistence and database constraints are implemented.
- API contracts are documented and validated.
- Failure and retry behavior are defined.
- Automated tests cover normal, boundary, and failure cases.
- Logs, metrics, and audit events are included where needed.
- Configuration and migration changes are documented.
- Relevant frontend states are implemented.
- Operational recovery is considered.
- No unresolved critical security or financial-integrity defects remain.

A feature is not complete merely because its endpoint returns a successful response.

## 19. Prioritization Rules

When trade-offs are necessary, prioritize:

1. Tenant isolation and authorization.
2. Data integrity and idempotency.
3. Correct subscription, entitlement, and quota semantics.
4. Accurate billing and immutable financial records.
5. Reliable payment integration.
6. Observability and recovery.
7. Customer-facing polish and secondary convenience features.

Do not postpone foundational security and integrity controls until the final hardening phase.

## 20. Initial Release Scope

The minimum viable production release must support:

- Tenant-aware authentication and authorization.
- A manageable plan catalog.
- Subscription creation and lifecycle management.
- Entitlement evaluation.
- At least one clearly defined usage meter.
- Idempotent usage ingestion.
- Usage aggregation.
- At least one quota enforcement model.
- Invoice generation and issuance.
- One payment-provider integration, if online collection is required for launch.
- Basic customer billing and usage screens.
- Audit logging.
- Operational monitoring.
- Automated backups and tested restoration.
- Tenant-isolation and financial-integrity test coverage.

Advanced pricing models, complex tax automation, multiple payment providers, elaborate reporting, and sophisticated analytics must be added only when supported by actual requirements.

If the first release does not require online payments, payment integration can be deferred while invoice generation and payment-status management remain properly designed.

## 21. Final Implementation Principles

1. Deliver the platform in dependency order.
2. Build complete vertical slices rather than disconnected infrastructure.
3. Test financial and security invariants continuously.
4. Prefer durable, database-backed workflows before adding distributed infrastructure.
5. Keep external providers behind explicit adapters.
6. Make every important operation observable and recoverable.
7. Introduce complexity only when requirements or measured workload justify it.
8. Treat production readiness as a verified engineering outcome rather than a checklist completed on paper.

This roadmap provides the implementation sequence for turning the architecture documents into a functioning Tally. Each phase must produce a reviewable, tested increment that preserves the integrity of the entire system.