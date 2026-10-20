# API Specification

**Path:** `docs/architecture/api-specification.md`

**Status:** Approved  
**Project:** Tally  
**API Style:** REST over HTTPS  
**Contract Format:** OpenAPI  
**Backend:** NestJS + TypeScript  
**Database:** PostgreSQL

## 1. Purpose

This document defines the API contract for the Tally. It establishes consistent resource naming, request and response formats, authentication assumptions, tenant isolation, error handling, pagination, idempotency, and versioning.

The API must expose stable contracts to customer applications, internal platform integrations, administrative interfaces, and payment-provider adapters.

The API is an interface to the domain model, not a direct mapping of database tables. Internal implementation details must remain encapsulated.

## 2. API design principles

1. **Contract-first:** define and maintain OpenAPI specifications alongside implementation.
2. **Versioned:** introduce breaking public changes through a new API version.
3. **Tenant-isolated:** every request is authorized against the appropriate tenant and billing account.
4. **Idempotent mutations:** retryable financial and subscription operations must not produce duplicate effects.
5. **Consistent errors:** use a shared error schema and stable error codes.
6. **Explicit lifecycle operations:** clients request business transitions rather than setting internal state fields.
7. **Validated input:** validate types, ranges, identifiers, and business invariants at the API boundary.
8. **Least privilege:** customer and administrative endpoints use distinct permissions.
9. **Observable:** propagate correlation identifiers through requests and background workflows.
10. **No hidden financial mutations:** clients cannot directly overwrite invoice totals, payment outcomes, or usage counters.

## 3. API structure

The public API uses the prefix:

`/v1`

Example:

`https://api.example.com/v1/subscriptions`

The hostname is illustrative and must be replaced by the deployed API domain.

Organize endpoints by domain:

- `/plans`
- `/subscriptions`
- `/tenants/{tenantId}/entitlements`
- `/tenants/{tenantId}/quotas`
- `/usage`
- `/invoices`
- `/payments`
- `/billing-account`
- `/admin`
- `/webhooks`

Public endpoints and administrative endpoints must have separate authorization policies, even if they share the same NestJS application.

Internal module calls must use domain services directly rather than making HTTP requests to the same application unnecessarily.

## 4. Authentication and authorization

### 4.1 Authentication

All protected endpoints require an authenticated identity through the platform's configured authentication mechanism.

The API must not assume that every caller is a human user. Supported callers may include:

- Customer applications.
- Tenant administrators.
- Platform administrators.
- Trusted backend services.
- Usage-reporting clients.
- Payment-provider webhook handlers.

Machine identities must use credentials appropriate to the identity platform. The API must not invent a parallel authentication mechanism for convenience.

### 4.2 Authorization

Authentication establishes who the caller is. Authorization determines which operation and resources they may access.

Required permissions include:

| Permission | Purpose |
|---|---|
| `plans:read` | View published plans and prices. |
| `subscriptions:read` | View authorized subscription records. |
| `subscriptions:manage` | Create, cancel, resume, or change subscriptions. |
| `entitlements:read` | Evaluate or inspect effective entitlements. |
| `quotas:read` | Inspect effective quotas and usage. |
| `usage:write` | Submit authorized usage events. |
| `billing:read` | View invoices, payments, and billing details. |
| `billing:pay` | Initiate an authorized payment. |
| `billing:manage` | Perform authorized billing administration. |
| `billing:refund` | Initiate refunds. |
| `catalog:manage` | Manage plan and price definitions. |
| `platform:admin` | Perform explicitly authorized platform-level operations. |

Permission names are stable identifiers. Their actual mapping to the identity platform must be documented during implementation.

### 4.3 Tenant resolution

Resolve tenant identity from trusted authentication context whenever possible.

A tenant ID in the URL is a resource selector, not proof of access.

For every tenant-scoped operation, verify that the authenticated caller may access the selected tenant and the requested resource. Do not rely on unguessable IDs as authorization.

## 5. Common request conventions

### 5.1 Content types

Requests containing JSON use:

`Content-Type: application/json`

Successful JSON responses use:

`Content-Type: application/json`

Document downloads may return an appropriate media type, such as `application/pdf`.

### 5.2 Identifiers

Use stable opaque identifiers for API resources. Clients must treat identifiers as strings and must not infer database structure from their format.

Invoice numbers intended for customer display are distinct from internal invoice IDs.

### 5.3 Timestamps

Represent timestamps in ISO 8601 format with a timezone, preferably UTC.

Example:

`2026-10-12T12:00:00Z`

Do not accept ambiguous local timestamps for lifecycle transitions or billing-period boundaries.

### 5.4 Money

Represent monetary values using an explicit currency and an exact amount representation.

Recommended API shape:

```json
{
  "amountMinor": 12500,
  "currency": "GHS"
}
```

Here, `amountMinor` represents minor currency units according to the configured currency precision. The value is illustrative.

The API must not assume every currency uses two decimal places. Monetary arithmetic must use exact integer or decimal representations internally.

### 5.5 Quantities

Quota values and usage quantities must specify their units where ambiguity is possible.

For example, distinguish bytes from gigabytes, milliseconds from seconds, and event counts from distinct-resource counts.

### 5.6 Unknown fields

Mutation endpoints must reject unsupported fields where accepting them could create ambiguity or conceal client errors.

Never silently accept client-supplied internal fields such as `status`, `amountDue`, `effectiveEntitlements`, or `paymentSucceeded` when the server owns those values.

## 6. Common response conventions

A successful resource response returns the resource representation directly unless a collection or operation-specific wrapper is needed.

Example subscription representation:

```json
{
  "id": "sub_123",
  "tenantId": "tenant_123",
  "productId": "product_123",
  "planVersionId": "plan_version_3",
  "priceVersionId": "price_version_2",
  "status": "active",
  "quantity": 1,
  "currentPeriodStart": "2026-10-01T00:00:00Z",
  "currentPeriodEnd": "2026-11-01T00:00:00Z",
  "cancelAtPeriodEnd": false,
  "version": 4,
  "createdAt": "2026-10-01T10:00:00Z",
  "updatedAt": "2026-10-01T10:00:00Z"
}
```

Example values are illustrative and do not represent a real account.

Do not return internal provider credentials, raw payment secrets, database internals, or sensitive reconciliation data through ordinary customer endpoints.

## 7. Error format

Use a consistent structured error response.

```json
{
  "type": "https://api.example.com/errors/validation-error",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_ERROR",
  "detail": "One or more request fields are invalid.",
  "requestId": "req_123",
  "errors": [
    {
      "field": "quantity",
      "code": "OUT_OF_RANGE",
      "message": "Quantity must be greater than zero."
    }
  ]
}
```

The response may follow the general problem-details approach while adding stable application-specific codes.

### 7.1 HTTP status codes

| Status | Use |
|---|---|
| `200 OK` | Successful retrieval or completed operation. |
| `201 Created` | Resource created. |
| `202 Accepted` | Operation accepted for asynchronous processing. |
| `204 No Content` | Successful operation without a response body. |
| `400 Bad Request` | Malformed request or invalid syntax. |
| `401 Unauthorized` | Missing or invalid authentication. |
| `403 Forbidden` | Caller lacks required permission. |
| `404 Not Found` | Resource not found or intentionally concealed. |
| `409 Conflict` | State conflict, duplicate conflict, or invalid transition. |
| `412 Precondition Failed` | A supplied conditional request precondition failed. |
| `422 Unprocessable Content` | Valid request syntax but invalid business input. |
| `429 Too Many Requests` | Rate limit exceeded. |
| `500 Internal Server Error` | Unexpected server failure. |
| `503 Service Unavailable` | Required dependency unavailable. |

Do not expose stack traces, SQL errors, provider secrets, or internal exception messages.

## 8. Pagination, filtering, and sorting

Collection endpoints must support pagination.

For initial implementation, use limit-and-cursor pagination where practical.

Example:

`GET /v1/invoices?limit=25&cursor=opaque_cursor`

A collection response may look like:

```json
{
  "data": [],
  "pagination": {
    "nextCursor": "opaque_cursor",
    "hasMore": false
  }
}
```

Requirements:

- Apply a reasonable default and maximum page size.
- Use stable ordering, including a unique tie-breaker.
- Bind cursors to the applicable filter and sort context.
- Validate filter names and values.
- Restrict sorting to explicitly supported fields.
- Enforce tenant authorization before returning results.

Financial and audit-history endpoints must use deterministic ordering so records are not skipped or duplicated during pagination under normal concurrent changes.

## 9. Idempotency and concurrency

### 9.1 Idempotency keys

Require or strongly recommend an idempotency key for operations that could create duplicate financial or commercial effects.

Header:

`Idempotency-Key: <unique-client-generated-value>`

Applicable operations include:

- Creating subscriptions.
- Requesting plan changes.
- Requesting cancellation where repeated requests could conflict.
- Creating quota reservations.
- Submitting usage events.
- Initiating payments.
- Issuing credit notes.
- Initiating refunds.
- Starting billing operations where appropriate.

The server stores the key, operation scope, relevant request fingerprint, and result.

Repeating the same key with equivalent parameters returns the existing logical result. Reusing the key with different parameters returns a conflict.

Idempotency records must be persisted for a duration appropriate to the operation. Financial operations may require long-lived uniqueness constraints beyond the temporary idempotency record.

### 9.2 Optimistic concurrency

Use an explicit version field or HTTP conditional requests for resources that may be updated concurrently.

For example, a client can submit an expected subscription version when requesting a plan change.

If the resource has changed since the client read it, return a conflict or failed-precondition response rather than silently overwriting another operation.

## 10. Plan catalog endpoints

### 10.1 List plans

`GET /v1/plans`

Permission: `plans:read`

Optional filters:

- Product.
- Availability.
- Supported billing interval.

Only published plans and price versions appropriate for the caller must be exposed through the customer-facing catalog.

### 10.2 Retrieve a plan

`GET /v1/plans/{planId}`

Returns plan details and applicable published version information.

### 10.3 List prices

`GET /v1/plans/{planId}/prices`

Returns available price versions and their currency, amount, interval, and eligibility.

The endpoint must not expose unpublished commercial configurations to unauthorized callers.

### 10.4 Administrative catalog management

Catalog creation, plan-version publication, and price-version management belong under a protected administrative route group.

Published versions must not be edited in place.

## 11. Subscription endpoints

### 11.1 Create a subscription

`POST /v1/subscriptions`

Permission: `subscriptions:manage`

Example request:

```json
{
  "tenantId": "tenant_123",
  "planVersionId": "plan_version_3",
  "priceVersionId": "price_version_2",
  "quantity": 1,
  "trialRequested": false
}
```

The server validates the tenant, published versions, price-plan compatibility, subscription cardinality, and activation policy.

The client cannot choose the resulting subscription status directly.

Return `201 Created` when the subscription is created synchronously. Return `202 Accepted` only if creation genuinely requires asynchronous completion.

### 11.2 Retrieve a subscription

`GET /v1/subscriptions/{subscriptionId}`

Permission: `subscriptions:read`

Return the authorized subscription representation and its current commercial terms.

### 11.3 List tenant subscriptions

`GET /v1/tenants/{tenantId}/subscriptions`

Permission: `subscriptions:read`

Return only subscriptions the caller is authorized to inspect.

### 11.4 Cancel a subscription

`POST /v1/subscriptions/{subscriptionId}/cancel`

Example request:

```json
{
  "mode": "period_end",
  "reason": "customer_requested"
}
```

Supported modes:

- `period_end`
- `immediate`

The server validates whether the requested mode is permitted and records the cancellation request. It determines the effective transition according to subscription policy.

### 11.5 Resume a subscription

`POST /v1/subscriptions/{subscriptionId}/resume`

Resume is permitted only when the current state and product policy allow it.

A cancelled or expired subscription must not be silently reactivated through this endpoint.

### 11.6 Request a plan change

`POST /v1/subscriptions/{subscriptionId}/plan-changes`

Example request:

```json
{
  "targetPlanVersionId": "plan_version_4",
  "targetPriceVersionId": "price_version_4",
  "effectiveMode": "period_end"
}
```

Supported effective modes must initially be:

- `immediate`
- `period_end`

The server validates compatibility and records the change. Billing determines any proration or invoice adjustment.

### 11.7 Retrieve subscription history

`GET /v1/subscriptions/{subscriptionId}/history`

Return an authorized chronological history of lifecycle changes, scheduled changes, and relevant commercial terms. Sensitive internal details must remain restricted to authorized administrators.

## 12. Entitlement endpoints

### 12.1 List effective entitlements

`GET /v1/tenants/{tenantId}/entitlements`

Permission: `entitlements:read`

Return effective entitlement values with their source, version, evaluation time, and applicable validity boundary where appropriate.

### 12.2 Evaluate one entitlement

`GET /v1/tenants/{tenantId}/entitlements/{key}`

Return the effective value and decision metadata.

A missing entitlement must be distinguishable from an explicitly granted `false`, `0`, or empty value.

### 12.3 Batch evaluation

`POST /v1/entitlements/evaluate`

Example request:

```json
{
  "tenantId": "tenant_123",
  "keys": [
    "feature.audit_export",
    "limits.projects",
    "support.tier"
  ]
}
```

The endpoint must evaluate multiple keys efficiently and return one result per requested key.

Do not allow the batch API to bypass platform restrictions or application authorization.

### 12.4 Administrative overrides

Administrative override endpoints must require explicit permissions and record a reason, scope, actor, and effective period.

Overrides must not bypass tenant suspension, platform restrictions, or security authorization.

## 13. Quota and usage endpoints

### 13.1 Retrieve effective quotas

`GET /v1/tenants/{tenantId}/quotas`

Permission: `quotas:read`

Return the effective limit, enforcement mode, period, current usage, reservations, and remaining capacity where meaningful.

A reported remaining amount is informational unless it is produced as part of an atomic reservation operation.

### 13.2 Retrieve a quota

`GET /v1/tenants/{tenantId}/quotas/{key}`

Return one quota policy and its current accounting state.

### 13.3 Submit usage events

`POST /v1/usage/events`

Permission: `usage:write`

Example request:

```json
{
  "tenantId": "tenant_123",
  "eventId": "evt_123",
  "eventType": "api.request.completed",
  "occurredAt": "2026-10-12T12:00:00Z",
  "subject": {
    "type": "service",
    "id": "service_123"
  },
  "measurements": {
    "requests": 1
  },
  "metadata": {
    "source": "api-gateway"
  }
}
```

The server validates the event identity, allowed event types, measurements, tenant scope, and reporting client's permissions.

The event ID must support idempotent ingestion. The API must not trust arbitrary client-supplied billable amounts or allow untrusted metadata to change pricing rules.

For batch ingestion, define a maximum batch size and return per-event accepted, duplicate, or rejected results.

### 13.4 Quota reservations

`POST /v1/quota-reservations`

Creates a reservation before a quota-protected operation.

Related endpoints:

- `GET /v1/quota-reservations/{reservationId}`
- `POST /v1/quota-reservations/{reservationId}/commit`
- `POST /v1/quota-reservations/{reservationId}/release`

Reservation transitions must be idempotent and authorized against the tenant and original operation.

## 14. Invoice endpoints

### 14.1 List invoices

`GET /v1/invoices`

Supported filters may include:

- Billing account.
- Invoice status.
- Issue-date range.
- Due-date range.
- Currency.

The server must enforce billing-account access before applying filters.

### 14.2 Retrieve an invoice

`GET /v1/invoices/{invoiceId}`

Returns the issued invoice or authorized draft representation, depending on the caller's permissions.

### 14.3 Retrieve invoice lines

`GET /v1/invoices/{invoiceId}/lines`

Return line items with quantities, units, prices, service periods, discounts, taxes and source references appropriate for the caller.

### 14.4 Retrieve invoice document

`GET /v1/invoices/{invoiceId}/document`

Return the rendered invoice document where document generation is supported.

The document must correspond to the issued invoice version. Regenerating a document must not recalculate or alter the financial record.

### 14.5 Credit notes and voids

Customer-facing clients must not directly issue credit notes or void invoices.

Authorized administrative operations must use dedicated endpoints, reason codes, and audit records.

## 15. Payment endpoints

### 15.0 Provider account configuration

`POST /v1/payment-provider-accounts`

Permission: tenant owner or administrator.

Connects or rotates the tenant's payment-provider credentials. Secret keys are write-only: the API stores them encrypted and returns only a safe account summary and the last four characters of the secret.

`GET /v1/payment-provider-accounts`

Returns connected provider accounts without credentials.

### 15.1 Initiate payment

`POST /v1/invoices/{invoiceId}/payments`

Permission: `billing:pay`

Example request:

```json
{
  "provider": "configured_provider",
  "returnUrl": "https://customer.example.com/billing/return"
}
```

The provider field is optional if the platform chooses a default provider. If accepted, it must be validated against the configured allowlist.

The server calculates the amount due and creates the payment request. It must not trust a client-provided amount as authoritative.

Return the internal payment ID and, a provider-hosted checkout URL.

### 15.2 Retrieve payment status

`GET /v1/payments/{paymentId}`

Return normalized payment status and authorized transaction details.

Do not expose provider secrets or sensitive payment credentials.

### 15.3 Refunds

Refunds belong to a restricted administrative API or an explicitly authorized customer workflow.

The server validates the original payment, refundable amount, currency, prior refunds, and applicable approval policy before initiating the request.

A refund request is not a confirmed refund until authoritative provider evidence or reconciliation establishes its outcome.

## 16. Billing-account endpoints

### 16.1 Retrieve billing account

`GET /v1/billing-account`

Return the billing account associated with the authenticated tenant or authorized customer context.

### 16.2 Update billing details

`PATCH /v1/billing-account`

Allow only explicitly editable billing fields, such as billing contact or address.

The server must validate field permissions and preserve relevant audit history.

Payment credentials and provider tokens must not be updated through this generic endpoint.

### 16.3 Retrieve credit balance

`GET /v1/billing-account/credit-balance`

Return the available credit balance and currency, if account credits are supported.

The response must distinguish available credit from credits that are pending, expired, reserved, or already applied.

## 17. Webhook endpoints

Payment-provider webhooks are machine-to-machine endpoints and must be treated differently from ordinary authenticated customer APIs.

Example route:

`POST /v1/webhooks/payments/{provider}`

Requirements:

- Verify provider authenticity.
- Validate event structure and required fields.
- Enforce provider-event deduplication.
- Persist accepted events durably.
- Process domain mutations asynchronously where appropriate.
- Return promptly after safe receipt.
- Support retries and reconciliation.
- Prevent a webhook from modifying resources outside the provider event's validated scope.

Provider webhooks must not use a browser session or a customer-supplied tenant ID as their authentication mechanism.

Webhook payloads must be mapped into internal domain events rather than passed directly into subscription or invoice database updates.

## 18. Asynchronous operations

Some operations may require background work, including:

- Large usage imports.
- Subscription migrations.
- Invoice-generation batches.
- Reconciliation runs.
- Bulk credit adjustments.

For asynchronous work, return `202 Accepted` with an operation identifier and a status resource.

Example:

```json
{
  "operationId": "op_123",
  "status": "queued",
  "statusUrl": "/v1/operations/op_123"
}
```

A general operation-status endpoint may be introduced if multiple workflows need the same interface.

The operation status must not expose another tenant's workflow or internal error details.

Background operations must be durable, retry-safe, and observable.

## 19. API versioning and compatibility

Use `/v1` for the initial public API.

Backward-compatible changes may include:

- Adding optional request fields.
- Adding response fields.
- Adding new endpoints.
- Adding documented optional filters.

Potentially breaking changes include:

- Removing or renaming fields.
- Changing a field's meaning or type.
- Changing a lifecycle transition contract.
- Changing monetary precision or representation.
- Changing authorization behavior in a way that invalidates existing clients.

Breaking changes require a new API version or a documented migration strategy.

Clients must ignore unknown response fields where practical. The server must not change the meaning of an existing field without a deliberate versioning decision.

## 20. OpenAPI and contract governance

Maintain OpenAPI specifications in the repository and use them to generate or validate API documentation.

Recommended practices:

- Define reusable schemas for money, timestamps, errors, pagination, and identifiers.
- Define request and response schemas for every public endpoint.
- Document authentication schemes and required permissions.
- Document idempotency requirements.
- Document lifecycle errors and conflict responses.
- Include examples for critical workflows.
- Validate the specification in CI.
- Detect accidental breaking changes.
- Test implementation responses against the documented contract.

The OpenAPI document is the authoritative interface contract. Database schemas and TypeScript interfaces alone do not replace it.

## 21. API security controls

Apply:

- Request-size limits.
- Input validation and normalization.
- Rate limits by caller and operation.
- Tenant-scoped resource authorization.
- Least-privilege administrative permissions.
- Secure handling of webhook secrets.
- Audit logging for financial mutations.
- Protection against replay and duplicate mutation requests.
- Safe error messages.
- Strict outbound URL validation for any accepted return URLs.

Return URLs must be restricted to approved destinations or validated against a controlled allowlist to prevent open redirects and phishing abuse.

Do not log authorization headers, provider secrets, raw payment credentials, or other sensitive data.

## 22. Testing strategy

### Contract tests

- Validate OpenAPI syntax and completeness.
- Confirm documented response schemas match implementation.
- Detect breaking schema changes.
- Verify standard error responses and status codes.
- Test pagination and filtering contracts.

### Authorization tests

- Unauthenticated requests are rejected.
- Missing permissions produce the correct denial.
- Tenant A cannot access Tenant B's resources.
- Administrative endpoints enforce elevated permissions.
- Webhooks require provider verification.
- Resource identifiers cannot bypass authorization.

### Idempotency tests

- Repeated subscription creation requests do not create duplicates.
- Repeated payment initiation does not create duplicate collection attempts.
- Duplicate usage events do not double-count.
- Duplicate webhook deliveries do not repeat financial effects.
- Reusing a key with different parameters returns a conflict.

### Domain integration tests

- Subscription transitions follow the lifecycle contract.
- Entitlement values match the effective plan and override policy.
- Quota reservations enforce limits under concurrency.
- Invoice totals match pricing rules.
- Partial payments and credit allocations produce consistent balances.
- Reconciliation operations are recoverable after failure.

### End-to-end tests

- Subscribe to a plan and retrieve the resulting subscription.
- Evaluate entitlements and retrieve effective quotas.
- Submit usage and inspect its accounting outcome.
- Generate an invoice and initiate payment.
- Process a provider webhook and verify the resulting payment state.
- Cancel a subscription and verify the effective entitlement behavior.
- Attempt cross-tenant access and confirm rejection.

## 23. Implementation sequence

1. Define shared schemas and error handling.
2. Implement authentication context and tenant authorization.
3. Implement catalog and subscription endpoints.
4. Implement entitlement and quota evaluation endpoints.
5. Implement usage ingestion and idempotency.
6. Implement invoice, payment, and billing-account endpoints.
7. Implement provider webhook processing.
8. Add pagination, concurrency controls, and asynchronous operation tracking.
9. Generate and validate OpenAPI documentation in CI.
10. Add contract, authorization, idempotency, and end-to-end tests.

## 24. Acceptance criteria

The API is ready when:

- All public endpoints are documented in OpenAPI.
- Authentication and tenant authorization are enforced consistently.
- Resource IDs cannot be used to bypass tenant isolation.
- Subscription and financial mutations use appropriate idempotency controls.
- Request and response schemas use consistent timestamp and monetary representations.
- Clients cannot directly set internal financial or lifecycle state.
- Error responses use stable codes and safe details.
- Pagination is deterministic and bounded.
- Webhook authenticity and event deduplication are enforced.
- API changes are checked for compatibility in CI.
- Automated tests cover authorization, idempotency, concurrency, and critical financial workflows.

## 25. Relationship to the next document

The next document, `docs/architecture/security-and-tenant-isolation.md`, will define the threat model, tenant-boundary enforcement, sensitive-data protection, secrets management, administrative access controls, and security testing requirements.

The governing principle is:

**The API exposes business capabilities through explicit, authorized contracts. It does not expose unrestricted access to internal state or financial records.**