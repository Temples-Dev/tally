# Quotas and Enforcement

**Path:** `docs/architecture/quotas-and-enforcement.md`

**Status:** Approved  
**Project:** Tally  
**Architecture:** Modular monolith with separately runnable API and worker processes

## 1. Purpose

This document defines how the platform enforces consumption limits, manages usage allowances, and prevents concurrent requests from exceeding protected resource limits.

The quota subsystem sits between entitlement evaluation and usage metering. It determines whether an operation may proceed based on the tenant's effective limits, current consumption, and applicable enforcement policy.

The implementation must support both hard limits and soft thresholds without confusing consumption control with financial billing.

### Goals

- Enforce tenant-level and, where explicitly configured, resource-level quotas.
- Support request counts, seats, storage, compute time, API calls, and other measurable resources.
- Prevent concurrent requests from bypassing hard limits.
- Support included allowances, soft limits, hard limits, and rate limits.
- Handle retries, reservations, expiration, and late-arriving usage events.
- Provide explainable enforcement decisions.
- Preserve an auditable record of quota changes and enforcement outcomes.

### Non-goals

This document does not define the complete usage-event pipeline, subscription lifecycle, invoice generation, or payment collection. Those are covered by the usage metering, subscription and entitlement, and billing documents.

## 2. Domain boundaries

| Component | Responsibility |
|---|---|
| Subscription | Determines the customer's commercial relationship and lifecycle. |
| Entitlement | Determines which features and limits are granted. |
| Quota policy | Defines how a measurable resource is constrained. |
| Quota evaluator | Determines whether an operation is permitted. |
| Reservation manager | Temporarily accounts for planned consumption. |
| Usage metering | Records and aggregates consumption events. |
| Billing | Calculates financial charges and adjustments. |

An entitlement may specify that a tenant can store 100 GB or make 50,000 API requests per billing period. The quota subsystem determines how those limits are enforced.

Usage metering records what happened. Quota enforcement controls what is allowed to happen next.

A quota decision does not itself create an invoice, charge a payment method, or authorize access to a protected application resource.

## 3. Quota types

### 3.1 Hard limit

A hard limit blocks an operation when the applicable quota would be exceeded.

Examples:

- Maximum active team members.
- Maximum projects.
- Maximum provisioned storage.
- Maximum API requests within a defined period.

Hard limits require an authoritative check and, where concurrent consumption is possible, an atomic enforcement mechanism.

### 3.2 Soft limit

A soft limit permits consumption beyond a threshold but generates a warning, notification, or operational event.

Examples:

- Storage usage reaches 80% of the allowance.
- Monthly API consumption reaches 90% of the included amount.
- A tenant approaches its allocated compute budget.

Soft limits must not be treated as hard denials.

### 3.3 Rate limit

A rate limit controls the frequency of operations within a rolling or fixed window.

Examples:

- Requests per second.
- Login attempts per minute.
- Resource creation attempts per hour.

Rate limits protect service capacity and abuse boundaries. They are distinct from monthly or annual consumption allowances.

### 3.4 Concurrent limit

A concurrent limit restricts the number of simultaneous active operations or resources.

Examples:

- Concurrent build jobs.
- Active compute sessions.
- Simultaneous exports.

The platform must define when a concurrent slot is acquired and released. Leaked reservations must be recoverable through expiration or reconciliation.

### 3.5 Included allowance

An included allowance is the quantity of a measurable resource included in a subscription's commercial terms.

Examples:

- 10,000 API requests per billing period.
- 100 GB of included storage.
- 500 minutes of processing time.

An included allowance is not necessarily a hard limit. The product's overage policy determines whether additional consumption is blocked, charged, or allowed with a warning.

### 3.6 Unmetered usage

An entitlement may explicitly declare a resource unmetered under the commercial plan.

Unmetered must not mean unlimited infrastructure consumption. Security, abuse prevention, platform capacity, and operational safety limits continue to apply.

Represent unmetered usage explicitly rather than using an extremely large numeric limit.

## 4. Quota model

### 4.1 Quota definition

A quota definition describes the resource being constrained.

Fields:

- `id`
- `key`
- `display_name`
- `description`
- `unit`
- `value_type`
- `period_type`
- `default_enforcement_mode`
- `status`
- `created_at`
- `updated_at`

Examples of keys include:

- `api.requests`
- `storage.bytes`
- `team.active_members`
- `projects.active`
- `jobs.concurrent`
- `compute.seconds`

Quota keys must be stable identifiers. Display names may change without changing the underlying key.

### 4.2 Effective quota policy

The effective quota policy is derived from the applicable subscription entitlements and product-level enforcement configuration.

Fields:

- `id`
- `tenant_id`
- `quota_definition_id`
- `limit_value`
- `enforcement_mode`
- `period_type`
- `effective_from`
- `effective_until`
- `source_type`
- `source_id`
- `policy_version`
- `created_at`

The policy must specify:

- The resource being measured.
- Its unit.
- Its applicable scope.
- The limit or explicit unmetered status.
- The measurement period.
- Whether enforcement is hard, soft, rate-based, or concurrency-based.
- What happens when the limit is reached.
- When the policy becomes effective.

Quota policy changes must be auditable and must not silently rewrite historical usage.

### 4.3 Usage counters

A usage counter stores the amount currently attributed to a quota scope and period.

Fields:

- `id`
- `tenant_id`
- `quota_definition_id`
- `period_start`
- `period_end`
- `used_value`
- `reserved_value`
- `counter_version`
- `updated_at`

A uniqueness constraint must identify one counter per tenant, quota definition, and period, unless the quota explicitly uses a more granular scope.

Use integer units where possible, such as bytes, milliseconds, or request counts. Where fractional quantities are necessary, use exact decimal arithmetic or an explicitly defined fixed-point representation.

Never use binary floating-point arithmetic for quota accounting.

### 4.4 Reservation

A reservation temporarily accounts for consumption before the operation finishes.

Fields:

- `id`
- `tenant_id`
- `quota_definition_id`
- `scope_key`
- `amount`
- `status`
- `idempotency_key`
- `expires_at`
- `committed_at`
- `released_at`
- `created_at`

Reservation states:

- `reserved`
- `committed`
- `released`
- `expired`

A reservation must be committed, released, or expired at most once. All transitions must be idempotent.

### 4.5 Scope

The initial implementation supports:

- Tenant scope.
- Tenant plus resource scope.
- Tenant plus user scope where explicitly required.
- Tenant plus API key or client scope where explicitly required.

The scope must be part of the counter and reservation identity. A request must not be able to select another tenant's scope through an untrusted parameter.

## 5. Period semantics

Quota periods must be explicit and deterministic.

Supported initial period types:

- `minute`
- `hour`
- `day`
- `month`
- `billing_period`
- `rolling_window`
- `lifetime`
- `concurrent`

### 5.1 Calendar and fixed periods

For calendar periods, define the timezone and boundary convention. Store period boundaries in UTC and calculate calendar boundaries using a specified timezone and calendar policy.

For fixed windows, calculate boundaries using a consistent UTC epoch-based rule.

For billing-period quotas, use the subscription's authoritative billing-period boundaries. Do not assume every tenant's month begins on the first calendar day.

### 5.2 Rolling windows

A rolling-window quota measures consumption over a moving interval, such as the preceding 60 seconds.

A single counter reset at fixed boundaries is not sufficient for a true rolling window. Use timestamped events, time buckets with a documented approximation, or a dedicated rate-limiting algorithm.

If bucketed approximation is used, document its accuracy and ensure it cannot undermine a security-critical limit.

### 5.3 Lifetime quotas

Lifetime quotas measure a cumulative quantity over a defined resource lifetime.

Examples include a limit on the total number of projects created, even if some projects are later archived.

The product must explicitly define whether deletion, archival, or deactivation returns capacity.

## 6. Enforcement modes

Each quota policy must specify an enforcement mode.

| Mode | Behavior |
|---|---|
| `hard` | Deny operations that would exceed the effective limit. |
| `soft` | Permit usage and emit threshold events. |
| `rate` | Enforce an operation frequency limit. |
| `concurrent` | Restrict simultaneous active operations. |
| `observe_only` | Measure and report without blocking. |

`observe_only` is useful during rollout, migration, or validation. It must not be mistaken for actual enforcement.

The API response must distinguish a denied operation from an allowed operation that exceeded a soft threshold.

## 7. Enforcement workflow

### 7.1 Basic operation

For a quota-protected operation:

1. Authenticate the caller.
2. Authorize access to the requested resource.
3. Determine the tenant and quota scope from trusted context.
4. Resolve the current entitlement and quota policy.
5. Identify the relevant period or concurrency scope.
6. Calculate the amount the operation intends to consume.
7. Atomically check and account for the required capacity.
8. Allow or deny the operation.
9. Record the decision and correlation ID.
10. Reconcile final usage after the operation completes.

Do not accept a client-provided tenant ID or usage amount as authoritative without validating it against trusted server-side state.

### 7.2 Hard-limit condition

For a simple additive quota, define:

- \(L\): effective limit.
- \(U\): committed usage.
- \(R\): outstanding reservations.
- \(A\): proposed additional amount.

The operation may proceed when:

\[
U + R + A \leq L
\]

This formula applies only when committed usage and reservations represent non-overlapping consumption. The implementation must prevent double-counting an operation when a reservation is committed.

For quotas that measure maximum values, unique resources, concurrency, or non-additive aggregates, use a quota-specific evaluation rule instead.

### 7.3 Atomic enforcement

A read followed by an independent write is unsafe for hard limits. Concurrent requests can each observe remaining capacity and both proceed.

Use a transaction or atomic database operation that verifies the limit and updates the counter together.

A possible transaction pattern is:

1. Ensure the counter row exists.
2. Lock the relevant counter row or perform an atomic conditional update.
3. Check the current committed and reserved amounts.
4. Apply the reservation or consumption update.
5. Commit the transaction.

If the operation spans multiple quotas, acquire locks in a stable order to reduce deadlocks. Roll back the full reservation transaction if any required hard quota cannot be satisfied.

PostgreSQL is the initial authority for correctness-sensitive quota decisions. Do not rely on an eventually consistent cache for hard-limit enforcement.

## 8. Reservations and long-running operations

Reservations are required when the system must guarantee capacity before an operation begins.

Examples include:

- Starting a build that consumes compute time.
- Allocating storage.
- Launching a concurrent job.
- Processing a batch with a known maximum cost.

### 8.1 Create a reservation

The reservation request must include:

- Authenticated tenant and scope.
- Quota key.
- Requested amount.
- Stable idempotency key.
- Expected operation or resource reference.
- Reservation expiry policy.

The server validates the request, resolves the current policy, and atomically reserves capacity.

A repeated request with the same idempotency key and equivalent parameters returns the original reservation. Reusing the key with conflicting parameters returns a conflict.

### 8.2 Commit a reservation

When the operation completes, commit the reservation using the actual amount consumed.

The transition must adjust reserved and committed usage atomically so the same amount is not counted twice.

If actual usage exceeds the reservation:

- Apply the quota's configured overrun policy.
- Record the actual usage.
- Emit an overrun event.
- Avoid pretending the operation consumed only its reserved amount.

The product may prevent overruns only when it can reliably stop work before additional consumption occurs.

### 8.3 Release a reservation

Release unused capacity when an operation is cancelled or fails before consuming the reserved resource.

Releasing a reservation must not erase real consumption that already occurred.

### 8.4 Expiration and recovery

Reservations require bounded lifetimes and reconciliation.

A worker must identify expired reservations and determine whether the underlying operation is still active before releasing capacity. For concurrency quotas, releasing a reservation while work is still running could violate the limit.

Where the operation state cannot be established, move the reservation into an explicit recovery state or escalate for reconciliation rather than blindly releasing it.

## 9. Usage accounting and reconciliation

The usage-metering subsystem records events. The quota subsystem consumes the appropriate authoritative usage state or counter updates.

### 9.1 Exactly-once effects

Distributed delivery may be at least once. The platform must therefore make accounting effects idempotent rather than assume every event is delivered exactly once.

Use a stable usage-event ID or accounting idempotency key. Enforce uniqueness in the database for accounting operations that must not be applied twice.

### 9.2 Synchronous versus asynchronous usage

Use synchronous accounting when the quota must be enforced before an operation proceeds.

Examples include creating a project under a hard project-count limit or reserving a concurrent job slot.

Asynchronous metering is suitable for analytics, reporting, soft thresholds, and usage that cannot be measured accurately until processing finishes.

Do not use delayed aggregate usage as the sole control for a hard limit when several requests can consume capacity concurrently.

### 9.3 Late events and corrections

A late usage event may change a reported aggregate after the original operation.

The system must distinguish:

- Operational counters used to prevent new consumption.
- Historical usage aggregates used for reporting and billing.
- Corrective events that adjust previously recorded usage.

Corrections must preserve the original event and record the adjustment. They must not silently rewrite the audit trail.

If corrected historical usage exceeds a quota, the configured policy determines the response. The system must not automatically reverse unrelated successful operations.

### 9.4 Reconciliation

A periodic reconciliation job must compare:

- Reservation records against counter totals.
- Counter totals against authoritative accounting events.
- Active concurrency reservations against running operations.
- Usage aggregates against source events.
- Effective quota policies against subscription and entitlement state.

Record discrepancies, retry recoverable failures, and alert on persistent inconsistencies.

## 10. Over-limit behavior

The outcome of exceeding a limit must be explicit per quota.

Possible outcomes include:

- Deny the operation.
- Permit the operation but emit a warning.
- Permit the operation and record overage for billing.
- Allow existing resources but block new resource creation.
- Permit limited functionality while restricting selected features.
- Reject new concurrent work while allowing running work to finish.

Do not implement one universal over-limit response for every resource type.

### 10.1 Existing resources

A plan downgrade or administrative quota reduction may cause current usage to exceed the new limit.

The platform must not automatically delete customer data or terminate running operations merely because a quota changed.

Instead, apply the quota-specific policy. For example, a project-count limit may block new project creation while preserving access to existing projects.

### 10.2 Overage billing

If overages are billable, record the relevant usage through the usage-metering interface. The billing subsystem determines the resulting financial charge.

Quota enforcement must not calculate invoice totals independently.

## 11. Rate-limiting architecture

Rate limits differ from period-based usage allowances because they often protect service capacity and abuse boundaries.

### 11.1 Initial implementation

Implement correctness-sensitive rate limits using PostgreSQL-backed counters or atomic operations initially. Add a specialized in-memory or distributed rate-limiting layer only when measured throughput requires it.

Suitable algorithms include:

- Fixed window.
- Sliding window.
- Token bucket.
- Leaky bucket.

Choose the algorithm based on whether the policy permits bursts, requires a strict rolling window, or regulates sustained throughput.

### 11.2 Token bucket

A token bucket contains a capacity \(C\), refill rate \(r\), and current token balance \(T\).

For elapsed time \(\Delta t\):

\[
T_{\text{new}} = \min(C, T + r\Delta t)
\]

A request with cost \(A\) is allowed if:

\[
T_{\text{new}} \geq A
\]

If allowed, deduct \(A\) atomically. If denied, return a retry hint when it can be calculated reliably.

Concurrent token updates must be atomic. A process-local bucket must not be used as the only enforcement authority when multiple API instances must share a limit.

### 11.3 Response behavior

For rate-limited HTTP operations, return `429 Too Many Requests` when appropriate. Include a retry hint or `Retry-After` header only when the wait time is known or reliably estimated.

Do not expose internal capacity data that could help attackers bypass abuse controls.

## 12. API design

Use versioned REST endpoints documented through OpenAPI.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/tenants/{tenantId}/quotas` | List effective quotas for an authorized tenant. |
| `GET` | `/v1/tenants/{tenantId}/quotas/{key}` | Retrieve current policy and usage. |
| `POST` | `/v1/quota-reservations` | Reserve capacity before an operation. |
| `GET` | `/v1/quota-reservations/{reservationId}` | Retrieve reservation status. |
| `POST` | `/v1/quota-reservations/{reservationId}/commit` | Commit actual usage. |
| `POST` | `/v1/quota-reservations/{reservationId}/release` | Release unused capacity. |

Internal application modules may use a domain service rather than call the public HTTP API. This avoids unnecessary network boundaries inside the modular monolith.

### 12.1 Enforcement result

A logical result may look like:

```json
{
  "allowed": false,
  "quotaKey": "projects.active",
  "reason": "QUOTA_EXCEEDED",
  "limit": 25,
  "used": 25,
  "reserved": 0,
  "requested": 1,
  "periodEnd": "2026-11-01T00:00:00Z",
  "policyVersion": 4
}
```

The API must distinguish between:

- Quota exceeded.
- Missing or invalid quota policy.
- Tenant or subscription ineligible.
- Reservation conflict.
- Temporary enforcement-service failure.

A failure to evaluate a required hard quota must not silently grant unlimited capacity.

### 12.2 Administrative operations

Quota-policy overrides and corrections require separate permissions, validated scopes, audit records, and explicit reasons.

Client applications must not be able to increase their own quota by submitting a modified limit or policy version.

## 13. Security and tenant isolation

Every quota operation must verify tenant scope and caller authorization.

Requirements:

- Derive tenant identity from authenticated context where possible.
- Validate resource ownership before reading or changing counters.
- Prevent callers from committing or releasing another tenant's reservation.
- Use unguessable reservation identifiers, but never rely on identifier secrecy as authorization.
- Apply request-size and batch-size limits to prevent accounting abuse.
- Protect administrative overrides with least-privilege permissions.
- Record suspicious repeated attempts to exceed limits.
- Prevent negative consumption values unless an explicit, authorized correction workflow supports them.
- Validate integer overflow and numeric boundaries.
- Avoid logging secrets or sensitive payloads.

A quota check is not a substitute for application authorization. The caller must first be permitted to perform the underlying action.

## 14. Observability

Collect structured logs, metrics, and traces.

Recommended metrics:

- Quota checks by outcome and quota category.
- Hard-limit denials.
- Soft-threshold events.
- Rate-limit denials.
- Reservation creation, commitment, release, and expiration counts.
- Reservation age and recovery backlog.
- Counter reconciliation discrepancies.
- Enforcement latency.
- Database lock contention and transaction retries.
- Usage overruns.
- Quota evaluation failures.

Avoid high-cardinality metric labels such as raw tenant IDs. Use access-controlled logs and traces for detailed diagnosis.

Alert on persistent reconciliation mismatches, stuck reservations, elevated enforcement failures, unexpected usage overruns, and database contention that threatens enforcement latency.

## 15. Testing strategy

### Unit tests

- Verify hard- and soft-limit behavior.
- Test fixed, rolling, billing-period, lifetime, and concurrent quota semantics.
- Test boundary conditions at period transitions.
- Verify unmetered status remains distinct from a numeric limit.
- Test reservation state transitions and idempotency.
- Test token-bucket refill and deduction logic.
- Verify over-limit behavior for existing resources.

### Integration tests

- Run concurrent requests against a nearly exhausted hard quota.
- Confirm no more capacity is granted than the configured limit permits.
- Verify multi-quota reservations roll back when one required quota fails.
- Test reservation commit, release, expiration, and recovery.
- Deliver duplicate usage events and confirm no double accounting.
- Test concurrent reservation attempts with the same idempotency key.
- Verify tenant isolation for every reservation operation.
- Confirm counter reconciliation detects deliberately introduced discrepancies.

### Failure tests

- Simulate database timeouts during reservation creation.
- Simulate worker crashes between job steps.
- Delay usage events and cache invalidations.
- Fail the operation after capacity has been reserved.
- Simulate a long-running operation whose reservation approaches expiry.
- Verify hard-limit checks fail closed when authoritative evaluation is unavailable.

### End-to-end tests

- Reach a project-count limit and confirm additional creation is blocked.
- Reach a soft storage threshold and confirm a warning is generated.
- Exceed a rate limit and confirm the expected HTTP response.
- Start concurrent jobs until the concurrency cap is reached.
- Downgrade a plan below current usage and verify existing data is preserved.
- Verify billable overages reach the usage-metering interface without duplicate accounting.

Use Jest, Supertest, Testcontainers, Vitest, React Testing Library, and Playwright where appropriate to backend and frontend boundaries.

## 16. Implementation sequence

1. Define stable quota keys, units, scopes, and period semantics.
2. Implement effective quota-policy resolution from entitlements.
3. Implement PostgreSQL-backed counters and atomic hard-limit checks.
4. Add reservation creation, commitment, release, and idempotency.
5. Add soft thresholds and operational events.
6. Implement period rollover and billing-period boundary handling.
7. Add rate limiting using the algorithm appropriate to each policy.
8. Implement reconciliation and reservation recovery workers.
9. Connect authoritative usage accounting and billable overage events.
10. Add administrative overrides, audit trails, monitoring, and runbooks.
11. Introduce specialized high-throughput infrastructure only when performance measurements justify it.

Keep the initial implementation inside the modular monolith. Do not introduce a separate quota service or distributed datastore before a demonstrated scalability requirement.

## 17. Acceptance criteria

The implementation is ready when:

- Every quota has a defined key, unit, scope, period, and enforcement mode.
- Hard-limit checks are atomic under concurrent load.
- Duplicate requests and usage events do not double-count consumption.
- Reservations are idempotent and have recoverable lifecycles.
- Expired reservations are not released blindly while protected work remains active.
- Rate limits behave according to their documented algorithm.
- Billing-period quotas align with subscription period boundaries.
- Plan changes and quota reductions preserve existing customer data.
- Overage handling is explicitly configured per quota.
- Tenant isolation applies to counters, reservations, and administrative operations.
- Reconciliation detects discrepancies and produces actionable alerts.
- Failure to evaluate a required hard quota does not grant unrestricted consumption.
- Billable usage is passed to billing through the metering boundary rather than calculated in the quota subsystem.
- Automated tests cover concurrency, retries, failure recovery, and boundary conditions.

## 18. Relationship to the next document

This document defines how consumption is controlled. The next document, `docs/architecture/billing-and-invoicing.md`, will define how subscriptions, recurring charges, metered usage, overages, credits, taxes invoices, and payment outcomes become auditable financial records.

The governing boundary is:

**Entitlements define what is granted. Quotas determine what may be consumed. Usage metering records what happened. Billing determines the financial consequences.**