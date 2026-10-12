# Subscriptions and Entitlements

**Path:** `docs/architecture/subscriptions-and-entitlements.md`

**Status:** Approved  
**Project:** Tally  
**Architecture:** Modular monolith with separately runnable API and worker processes

## 1. Purpose

This document defines how customers subscribe to commercial plans and how the platform determines which features, capabilities, and configured limits each customer receives.

The implementation must separate commercial agreements from access decisions and consumption enforcement. This prevents subscription lifecycle changes, billing events, and usage processing from becoming tightly coupled.

### Goals

- Model subscription lifecycles and transitions explicitly.
- Preserve the commercial terms accepted by each customer.
- Resolve entitlements deterministically.
- Support trials, renewals, upgrades, downgrades, pauses, and cancellations.
- Provide reliable entitlement evaluation for application integrations.
- Maintain auditable history of subscription and entitlement changes.
- Support future billing-provider integrations without coupling the domain to a specific provider.

### Non-goals

This document does not define detailed invoice calculations, payment collection, usage aggregation, or quota enforcement. Those are covered by separate architecture documents.

## 2. Domain boundaries

The following concepts must remain distinct.

| Concept | Responsibility |
|---|---|
| Product catalog | Defines what the platform offers. |
| Plan version | Defines a versioned set of features and included capabilities. |
| Price version | Defines the commercial price, currency, billing interval, and pricing terms. |
| Subscription | Records a customer's commercial relationship to a plan. |
| Entitlement | Defines a capability or configuration granted to a customer. |
| Entitlement evaluation | Determines the effective entitlement at a particular time. |
| Quota | Defines consumption thresholds and enforcement behavior. |
| Invoice | Records a financial obligation for a billing period or adjustment. |
| Payment | Records collection attempts and confirmed payment outcomes. |

A plan describes what a customer can purchase. A subscription records what the customer has purchased. Entitlements determine what capabilities are granted. Quotas determine whether a particular amount of consumption is permitted.

Entitlements do not replace application-level authorization. An application must still verify that a user can access the particular resource or perform the requested action.

## 3. Core design principles

1. **Versioned commercial terms:** published plan and price versions are immutable.
2. **Explicit transitions:** subscription state changes occur through defined domain operations.
3. **Historical accuracy:** existing subscriptions retain their accepted terms until an explicit change takes effect.
4. **Deterministic evaluation:** the same effective inputs produce the same entitlement result.
5. **Tenant isolation:** every subscription and entitlement assignment is scoped to the appropriate tenant or customer.
6. **Auditable overrides:** manual entitlement changes require an actor, reason, scope, and expiration policy.
7. **Event-driven integration:** lifecycle changes emit durable domain events after the transaction commits.
8. **Fail-safe enforcement:** stale or unavailable entitlement information must not silently grant protected capabilities.

## 4. Plan and price versioning

### 4.1 Plan

A plan represents a commercial offering, such as Starter, Professional, or Enterprise.

Fields:

- `id`
- `product_id`
- `key`
- `name`
- `description`
- `status`
- `created_at`
- `updated_at`

The plan identity remains stable while its published versions change.

### 4.2 Plan version

A plan version captures the features, default entitlements, and included allowances available under a particular revision.

Fields:

- `id`
- `plan_id`
- `version`
- `status`
- `effective_from`
- `effective_until`
- `published_at`
- `created_at`

Plan-version status may include `draft`, `published`, and `retired`.

Once published, a version must not be edited in place. Changes create a new version. Retiring a version prevents new subscriptions from selecting it but does not automatically invalidate existing subscriptions.

### 4.3 Price version

A price version defines commercial terms independently of the plan's capabilities.

Fields:

- `id`
- `plan_id`
- `version`
- `currency`
- `amount_minor`
- `billing_interval`
- `billing_interval_count`
- `effective_from`
- `effective_until`
- `status`

Prices must use integer minor units or an exact decimal representation. Binary floating-point arithmetic must never be used for financial calculations.

A price version is immutable once published. Changes to price, currency, or billing interval create a new version.

### 4.4 Subscription snapshots

When a subscription is created, it must reference the selected plan version and price version. The platform must preserve the terms that applied when the subscription was accepted.

If additional commercial terms are configurable, store an immutable subscription snapshot or versioned references sufficient to reconstruct those terms.

Publishing a new plan version must not silently change active subscriptions.

## 5. Subscription data model

The subscription aggregate represents the customer's agreement to receive a service under defined terms.

Fields:

- `id`
- `tenant_id`
- `customer_id`
- `product_id`
- `plan_version_id`
- `price_version_id`
- `status`
- `quantity`
- `billing_anchor_at`
- `current_period_start`
- `current_period_end`
- `trial_start`
- `trial_end`
- `cancel_at_period_end`
- `cancel_at`
- `ended_at`
- `grace_period_end`
- `version`
- `created_at`
- `updated_at`

The `version` field supports optimistic concurrency control.

The system must distinguish the subscription's lifecycle status from invoice and payment statuses. An unpaid invoice does not, by itself, prove that a subscription must immediately become inactive.

### 5.1 Initial subscription cardinality

For the initial implementation, allow **one active or trialing subscription per tenant and product**.

A tenant may subscribe to different products independently. Multiple subscriptions for the same product require an explicit future aggregation policy before being enabled.

Use database constraints or transactional domain checks to prevent conflicting subscriptions, including concurrent creation attempts.

Pending, cancelled, and historical records must not be treated as active subscriptions simply because they exist.

## 6. Subscription lifecycle

### 6.1 States

| State | Meaning |
|---|---|
| `pending` | Created but not yet activated. |
| `trialing` | A valid trial is in progress. |
| `active` | The subscription is currently entitled to service, subject to other restrictions. |
| `past_due` | A payment obligation is overdue under the billing policy. |
| `paused` | Service has been temporarily suspended through an explicit policy or operation. |
| `cancelled` | The subscription has been cancelled and no longer grants subscription-based entitlements. |
| `expired` | The subscription or trial ended without continuing service. |

These states describe the subscription relationship, not individual invoices.

### 6.2 Allowed transitions

| From | To | Trigger |
|---|---|---|
| `pending` | `trialing` | Trial activation. |
| `pending` | `active` | Successful activation under the product's activation policy. |
| `pending` | `cancelled` | Cancellation before activation. |
| `pending` | `expired` | Activation window expires. |
| `trialing` | `active` | Trial converts to a paid or otherwise active subscription. |
| `trialing` | `expired` | Trial ends without continuation. |
| `trialing` | `cancelled` | Cancellation takes effect immediately. |
| `active` | `past_due` | Billing policy marks an obligation overdue. |
| `active` | `paused` | An authorized pause takes effect. |
| `active` | `cancelled` | Immediate cancellation takes effect. |
| `active` | `expired` | Subscription reaches a defined terminal end. |
| `past_due` | `active` | Payment recovery or another approved resolution restores service. |
| `past_due` | `paused` | Recovery policy suspends service. |
| `past_due` | `cancelled` | Cancellation takes effect. |
| `past_due` | `expired` | Recovery window ends and the subscription terminates. |
| `paused` | `active` | Authorized resumption. |
| `paused` | `cancelled` | Cancellation takes effect. |
| `paused` | `expired` | Subscription reaches its terminal end. |

`cancelled` and `expired` are terminal in the initial implementation. Reactivation creates a new subscription or uses a separately specified renewal operation; it must not silently reopen a historical subscription.

Every transition must be validated against the current state, actor permissions, effective time, and applicable policy.

### 6.3 Cancellation

Support two cancellation modes:

- **At period end:** record the cancellation request, set `cancel_at_period_end`, and preserve entitlements until the effective end, unless another restriction applies.
- **Immediate:** terminate subscription-based entitlements at the effective cancellation time.

The cancellation request and effective cancellation are distinct. A subscription scheduled to cancel remains active until cancellation actually takes effect.

Cancellation must not erase invoices, payments, usage records, or historical subscription terms.

### 6.4 Trials

Trials must have explicit start and end timestamps.

The product policy determines whether a payment method is required and what happens when the trial ends. The initial default must be:

- Trial entitlements are granted while the subscription is `trialing`.
- At the trial end, the subscription converts to `active` only if the configured conversion conditions are satisfied.
- Otherwise, the subscription becomes `expired`.
- A worker processes trial-end transitions, with a periodic reconciliation job to recover missed work.
- Entitlement evaluation checks timestamps directly so a delayed worker cannot accidentally extend a trial indefinitely.

## 7. Billing periods, renewals, and payment failures

### 7.1 Billing periods

Each subscription has an explicit billing anchor and current period boundaries.

The billing module owns invoice generation and proration calculations. The subscription module provides period information and lifecycle changes but does not calculate invoice totals.

All stored timestamps use a consistent UTC representation. Billing-calendar rules, including month-end behavior, must be defined by the billing policy rather than inferred from elapsed seconds.

### 7.2 Renewals

Renewal processing must be idempotent. Re-running a renewal job must not create duplicate invoices or extend a subscription multiple times.

The renewal workflow must:

1. Identify subscriptions approaching renewal.
2. Request billing-period invoice creation.
3. Record the renewal operation and its idempotency key.
4. Apply the billing policy's payment and grace-period outcomes.
5. Advance the subscription period only according to the configured renewal policy.
6. Emit a durable event after the state change commits.

A payment-provider callback is an input to this workflow, not permission to mutate arbitrary subscription fields directly.

### 7.3 Failed payments and grace periods

The billing policy defines retry schedules, grace periods, and service restrictions.

A recommended initial policy is:

- A failed renewal payment may transition `active` to `past_due`.
- The customer retains the explicitly configured grace-period entitlements while the grace period is valid.
- When the grace period ends, the subscription transitions to `paused` or `expired`, according to product policy.
- A confirmed recovery transitions `past_due` to `active` only after the required conditions are satisfied.
- Duplicate, delayed, and out-of-order provider events must not cause invalid transitions.

The policy must be configurable, but its initial defaults must be documented and tested.

## 8. Plan changes and quantity changes

### 8.1 Upgrades

An upgrade may take effect immediately or at the next billing-period boundary.

For an immediate upgrade:

- Validate that the new plan version and price version are available.
- Record the effective time and previous terms.
- Update the subscription through a transaction.
- Recalculate the effective entitlement set.
- Emit a `subscription.plan_changed` event.
- Delegate any proration and invoice adjustments to the billing module.

### 8.2 Downgrades

Downgrades must default to taking effect at the next billing-period boundary unless the product explicitly supports immediate downgrades.

A downgrade must not silently remove access to customer data. If a lower plan has smaller limits, the quota policy determines whether new consumption is blocked, existing resources remain accessible, or the customer must take corrective action.

### 8.3 Scheduled changes

Scheduled plan changes must be represented as explicit records with:

- Current and target plan versions.
- Current and target price versions.
- Requested effective time.
- Actor and reason.
- Status.
- Idempotency key.

A worker applies due changes transactionally. Entitlement evaluation must use the plan version effective at the requested evaluation time, not merely the newest plan in the catalog.

### 8.4 Quantity changes

Quantity changes may affect seats, resource counts, or another commercial dimension.

Store the quantity and its effective time. The meaning of quantity must be defined by the product and must not be assumed to represent user seats in every subscription.

Billing adjustments and quota recalculation must follow their respective policies.

## 9. Entitlement model

An entitlement is a named capability or configuration value granted to a tenant for a defined period.

Examples include:

- `feature.audit_export`: boolean feature availability.
- `limits.team_members`: numeric limit.
- `limits.projects`: numeric limit.
- `features.custom_domains`: boolean feature availability.
- `storage.retention_days`: numeric configuration.
- `support.tier`: enumerated service level.
- `integrations.enabled_types`: a controlled set of integration types.

### 9.1 Entitlement definition

Each entitlement definition must include:

- `id`
- `key`
- `display_name`
- `description`
- `value_type`
- `default_value`
- `validation_schema`
- `status`
- `created_at`
- `updated_at`

Supported initial value types:

- `boolean`
- `integer`
- `decimal`
- `string`
- `enum`
- `json`

Values must be validated against the definition. Avoid arbitrary executable expressions or untrusted code as entitlement values.

Definitions are versioned or changed through controlled migrations when changes could alter the meaning or validation of existing values.

### 9.2 Entitlement assignments

An assignment connects an entitlement definition to a source, scope, value, and effective period.

Potential sources include:

- Published plan version.
- Subscription-specific terms.
- Authorized tenant override.
- Platform-level policy.

Fields:

- `id`
- `tenant_id`
- `entitlement_definition_id`
- `source_type`
- `source_id`
- `value`
- `effective_from`
- `effective_until`
- `priority`
- `reason`
- `created_by`
- `created_at`

The system must preserve assignment history. Expiration or replacement must not delete the historical record.

### 9.3 Entitlement scope

The initial scope is the tenant. Subscription-level records determine which plan's entitlement definitions apply to that tenant.

Resource-specific entitlement scopes can be introduced later if a real product requirement demands them. They must not be approximated by mixing resource authorization into tenant-level entitlement resolution.

## 10. Entitlement resolution

Entitlement resolution must be deterministic, explainable, and independent of request order.

### 10.1 Evaluation sequence

Evaluate in this order:

1. **Platform restrictions:** verify that the platform has not disabled the tenant, product, or capability.
2. **Tenant status:** reject entitlement grants when the tenant is suspended or otherwise ineligible.
3. **Subscription eligibility:** identify the subscription and its lifecycle state at the requested effective time.
4. **Plan version:** load the immutable plan version applicable to that subscription.
5. **Plan entitlements:** obtain the entitlement values defined by that version.
6. **Applicable subscription terms:** apply explicit subscription-specific grants or restrictions.
7. **Authorized overrides:** apply valid tenant overrides according to the precedence rules below.
8. **Validation:** validate the resulting value against the entitlement definition.
9. **Decision:** return the effective value or a denial with a machine-readable reason.

An override must never bypass platform restrictions, tenant suspension, authentication requirements, or application authorization.

### 10.2 Precedence rules

Use the following precedence:

1. Platform and tenant restrictions are hard gates.
2. A subscription must be eligible under its lifecycle policy.
3. The applicable published plan version establishes the baseline.
4. Explicit subscription-specific terms override the baseline where permitted.
5. Authorized tenant overrides apply only to keys that permit overrides.

For multiple assignments at the same precedence level, reject ambiguous conflicts rather than selecting an arbitrary row. If multiple sources must contribute to one entitlement, define a specific merge strategy for that entitlement type.

Examples of merge strategies include:

- Boolean: explicit grant or deny, with a documented policy.
- Numeric limit: replace, minimum, maximum, or additive value, chosen explicitly per key.
- Enumerated value: replace with a valid enum member.
- Set: union or intersection, explicitly configured.
- JSON: schema-validated replacement; deep merge only where deliberately supported.

The default strategy is replacement at the applicable precedence level. Do not assume that all entitlements can be combined by taking the maximum value.

### 10.3 Past-due and paused subscriptions

The entitlement service must not treat every non-`active` state identically.

- `trialing`: grant the configured trial entitlements.
- `active`: grant eligible subscription entitlements.
- `past_due`: apply the explicit grace-period policy.
- `paused`: deny subscription-dependent entitlements unless a documented policy allows limited access.
- `cancelled` or `expired`: deny subscription-dependent entitlements after the effective termination time.
- `pending`: grant only capabilities explicitly required before activation.

A valid grace period may preserve selected capabilities, but it must not silently reactivate the subscription.

### 10.4 Evaluation response

A logical response may look like:

```json
{
  "tenantId": "tenant_123",
  "key": "limits.projects",
  "allowed": true,
  "value": 25,
  "reason": "plan_entitlement",
  "subscriptionId": "sub_123",
  "planVersion": 3,
  "evaluatedAt": "2026-10-12T12:00:00Z",
  "validUntil": "2026-11-01T00:00:00Z",
  "entitlementVersion": 18
}
```

For a boolean feature, `allowed` can represent the final decision. For other value types, `allowed` indicates whether the entitlement is available and valid; `value` carries the effective configuration.

The API must distinguish a missing entitlement from a value of `false`, `0`, or an empty string. Denials must use stable machine-readable reason codes such as:

- `TENANT_SUSPENDED`
- `SUBSCRIPTION_REQUIRED`
- `SUBSCRIPTION_INACTIVE`
- `TRIAL_EXPIRED`
- `ENTITLEMENT_NOT_DEFINED`
- `ENTITLEMENT_NOT_GRANTED`
- `ENTITLEMENT_INVALID`
- `PLATFORM_RESTRICTED`

Do not expose internal security-sensitive details in public responses.

## 11. Entitlement caching and consistency

Entitlement evaluation may be frequent, so caching is appropriate. However, stale cached grants must not continue to authorize protected capabilities after revocation.

### 11.1 Initial strategy

Use PostgreSQL as the source of truth and introduce a bounded in-process cache only after correctness is established.

Cache keys must include:

- Tenant ID.
- Product ID.
- Entitlement key.
- Relevant entitlement or subscription version.

Cache entries must have a finite TTL and must not outlive the earliest relevant effective boundary, such as a trial end or scheduled cancellation.

### 11.2 Invalidation

After a committed subscription, plan-change, or override transaction:

1. Write an outbox event in the same database transaction.
2. Publish or process the event asynchronously.
3. Invalidate affected cache entries or advance a tenant entitlement version.
4. Record failures and retry delivery.

Relevant events include:

- `subscription.activated`
- `subscription.plan_changed`
- `subscription.past_due`
- `subscription.paused`
- `subscription.resumed`
- `subscription.cancelled`
- `subscription.expired`
- `subscription.trial_ended`
- `entitlement.override_created`
- `entitlement.override_updated`
- `entitlement.override_expired`

Consumers must handle duplicate events safely.

### 11.3 Revocation guarantees

For high-impact operations, do not rely solely on an eventually invalidated cache. Use a sufficiently fresh authoritative check or a version/fencing mechanism before granting the operation.

If the entitlement service is unavailable, protected operations must fail closed unless an explicitly documented, low-risk capability has a defined fallback. A cache must not turn an unknown state into an unrestricted grant.

The platform must document its expected revocation propagation target and test it under worker delays and failures.

## 12. API design

Use versioned REST endpoints with OpenAPI documentation.

### 12.1 Plan catalog

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/plans` | List published plans available to the caller. |
| `GET` | `/v1/plans/{planId}` | Retrieve plan details and applicable published versions. |
| `GET` | `/v1/plans/{planId}/prices` | List available published prices. |

Administrative plan creation and publication endpoints must be protected by dedicated permissions.

### 12.2 Subscription management

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/v1/subscriptions` | Create a subscription or trial. |
| `GET` | `/v1/subscriptions/{subscriptionId}` | Retrieve subscription details. |
| `GET` | `/v1/tenants/{tenantId}/subscriptions` | List authorized tenant subscriptions. |
| `POST` | `/v1/subscriptions/{subscriptionId}/cancel` | Request immediate or period-end cancellation. |
| `POST` | `/v1/subscriptions/{subscriptionId}/resume` | Resume a paused subscription where permitted. |
| `POST` | `/v1/subscriptions/{subscriptionId}/plan-changes` | Request a plan change. |
| `GET` | `/v1/subscriptions/{subscriptionId}/history` | Retrieve authorized lifecycle and commercial history. |

Mutation endpoints must support idempotency keys where client retries could otherwise create duplicate subscriptions, cancellations, or plan changes.

Use optimistic concurrency or explicit expected-version fields for conflicting updates.

### 12.3 Entitlement evaluation

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/tenants/{tenantId}/entitlements` | List effective entitlements for an authorized tenant. |
| `GET` | `/v1/tenants/{tenantId}/entitlements/{key}` | Evaluate one entitlement. |
| `POST` | `/v1/entitlements/evaluate` | Evaluate multiple entitlement keys in one request. |

The evaluation endpoint must derive the tenant from an authenticated, authorized context wherever possible. A caller must not gain access to another tenant's entitlement data by changing an ID in the request.

Administrative override management must use a separate permission-protected endpoint group.

### 12.4 API behavior

- Use consistent error schemas and stable error codes.
- Validate plan availability, entitlement key, value type, and effective dates.
- Use appropriate `400`, `401`, `403`, `404`, `409`, and `422` responses.
- Avoid leaking whether another tenant's subscription exists.
- Return version and effective-time metadata where useful for consistency.
- Do not allow public clients to set internal lifecycle status fields directly.

## 13. Transactional integrity and background processing

Subscription mutations must run in database transactions.

For an activation or plan change:

1. Load and validate the current subscription version.
2. Verify the requested plan and price versions.
3. Apply the transition or scheduled-change record.
4. Increment the subscription version.
5. Write audit and outbox records.
6. Commit.
7. Let workers process downstream billing, notifications, and cache invalidation.

The outbox record must be committed with the state change so a process crash cannot leave a committed subscription update with no durable integration event.

Background jobs must be retry-safe. Use stable job identifiers, idempotency keys, and database constraints to prevent duplicate transitions.

Periodic reconciliation must identify missed trial expirations, overdue renewals, due scheduled changes, and undelivered outbox records.

## 14. Security and audit

### 14.1 Authorization

Use role- and permission-based checks for:

- Creating and managing subscriptions.
- Changing plans or commercial terms.
- Cancelling and resuming subscriptions.
- Publishing catalog versions.
- Creating or modifying entitlement overrides.
- Viewing billing-related subscription history.
- Performing cross-tenant administrative operations.

Tenant administrators must not be able to modify published catalog versions or override platform-wide restrictions unless explicitly granted a separate platform-level role.

### 14.2 Audit events

Record at least:

- Subscription creation and activation.
- Lifecycle transitions and their causes.
- Trial start and end.
- Plan, price, and quantity changes.
- Cancellation requests and effective cancellation.
- Manual overrides and their expiration.
- Administrative corrections.
- Rejected invalid transitions and security-sensitive attempts.

Each audit entry must include the actor or system process, tenant, affected object, timestamp, operation, reason, correlation ID, and relevant before/after values. Avoid storing secrets or unnecessary personal information.

Audit history must not be editable through normal business APIs.

## 15. Observability

Provide structured logs, metrics, and traces for lifecycle and entitlement operations.

Recommended metrics:

- Subscription counts by lifecycle state.
- Subscription transition failures.
- Trial expirations delayed beyond target.
- Scheduled plan changes applied late.
- Entitlement evaluation latency and error rate.
- Cache hit rate and invalidation lag.
- Outbox backlog and oldest undelivered event age.
- Invalid transition attempts.
- Subscription reconciliation discrepancies.

Alert on persistent transition failures, excessive entitlement-evaluation errors, cache invalidation lag beyond the documented target, and growing reconciliation backlogs.

Avoid high-cardinality metrics labels such as raw tenant IDs. Put detailed identifiers in access-controlled logs or traces.

## 16. Testing strategy

### Unit tests

- Validate every permitted and forbidden lifecycle transition.
- Test trial and cancellation boundaries.
- Verify plan-version selection at different effective times.
- Test entitlement precedence and each supported merge strategy.
- Verify type and schema validation.
- Test subscription eligibility during grace periods.
- Verify that platform restrictions cannot be bypassed by overrides.

### Integration tests

- Create subscriptions under concurrent requests.
- Verify uniqueness constraints for one active or trialing subscription per tenant and product.
- Apply upgrades and downgrades transactionally.
- Test duplicate and out-of-order payment-provider events.
- Verify outbox records are committed with subscription changes.
- Simulate worker failure and successful retry.
- Verify tenant isolation across subscription and entitlement endpoints.

### Cache and consistency tests

- Ensure cancellation invalidates relevant cached grants.
- Ensure a trial does not remain valid after its end because of a delayed worker.
- Verify TTL boundaries and version changes.
- Simulate lost or delayed invalidation events.
- Confirm that high-impact operations do not accept stale authorization decisions.

### End-to-end tests

- Create a trial, evaluate entitlements, and verify trial expiration.
- Activate a paid subscription and verify feature availability.
- Upgrade a plan and verify the new effective entitlement values.
- Schedule a downgrade and verify the transition at the boundary.
- Cancel immediately and verify that subscription-based grants stop.
- Simulate a failed renewal, grace period, and successful recovery.

Use Jest, Supertest, Testcontainers, Vitest, React Testing Library, and Playwright where appropriate to the backend and frontend boundaries.

## 17. Implementation sequence

1. Implement catalog, plan-version, and price-version persistence.
2. Implement subscription creation and lifecycle transition validation.
3. Add trial handling and scheduled lifecycle jobs.
4. Implement entitlement definitions and plan assignments.
5. Implement deterministic entitlement evaluation without caching.
6. Add authorized subscription-specific terms and tenant overrides.
7. Add transactional outbox integration and reconciliation.
8. Implement entitlement caching with bounded staleness and invalidation.
9. Add REST endpoints and OpenAPI documentation.
10. Add payment-provider event integration through the billing boundary.
11. Add monitoring, security tests, and operational runbooks.

Do not introduce a separate entitlement microservice or distributed cache before measured requirements justify the added complexity.

## 18. Acceptance criteria

The implementation is ready when:

- Published plan and price versions cannot be modified in place.
- Existing subscriptions retain their accepted commercial terms until an explicit change takes effect.
- All subscription transitions are validated and auditable.
- Trial expiration and scheduled changes remain correct after worker failures.
- Duplicate requests and provider events cannot create duplicate lifecycle effects.
- Entitlement evaluation is deterministic and schema-validated.
- Platform and tenant restrictions cannot be bypassed by plan settings or overrides.
- The initial one-subscription-per-tenant-and-product rule is enforced transactionally.
- Cancellation and other revocations propagate within the documented consistency target.
- High-impact operations do not rely solely on potentially stale cache entries.
- Cross-tenant subscription and entitlement access is prevented.
- Billing calculations remain within the billing module.
- Quota enforcement remains within the quota module.
- Automated tests cover lifecycle transitions, entitlement resolution, retries, and tenant isolation.

## 19. Relationship to the next documents

This document establishes the subscription and entitlement contract.

The next document, `docs/architecture/quotas-and-enforcement.md`, will define how effective limits and usage allowances are enforced during operations, including concurrency, over-limit behavior, reservations, and race conditions.

The subsequent billing document will define invoices, proration, payment collection, credits, adjustments, and financial reconciliation.

These boundaries are intentional: **subscriptions define the commercial relationship, entitlements define granted capabilities, quotas control consumption, and billing records the financial consequences.**