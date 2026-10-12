# Tally — Domain Model

## 1. Purpose

This document defines the core domain entities, their relationships, lifecycle states, ownership boundaries, and business invariants for the Tally.

The domain model separates usage measurement, access entitlements, subscription management, billing calculations, invoice obligations, and payment processing.

The model is designed for a multi-tenant modular monolith using NestJS, TypeScript, and PostgreSQL.

## 2. Domain Boundaries

The platform is divided into the following domains.

| Domain | Responsibility |
|---|---|
| Tenancy | Organizations, tenants, and membership |
| Customer Management | Customer accounts and billing profiles |
| Catalog | Products, plans, metrics, and price versions |
| Subscriptions | Subscription lifecycle and plan assignments |
| Usage Metering | Usage events and aggregated measurements |
| Entitlements | Feature access and included allowances |
| Quotas | Consumption limits and enforcement |
| Billing | Charge calculation and billing periods |
| Invoicing | Invoice documents, line items, and adjustments |
| Payments | Payment attempts, provider references, and reconciliation |
| Audit | Historical records of significant actions |
| Background Processing | Durable jobs and retry state |

Each domain owns its business rules. Other domains interact with it through application services and explicit contracts.

## 3. Tenant and Customer Model

### 3.1 Tenant

A `Tenant` represents an organization or isolated customer environment using the platform.

Attributes:

- `id`
- `name`
- `slug`
- `status`
- `created_at`
- `updated_at`

Supported status values:

- `active`
- `suspended`
- `closed`

A tenant is the primary isolation boundary for tenant-owned resources.

**Invariants:**

- A tenant identifier is immutable.
- Tenant-owned records must be scoped to the correct tenant.
- Suspended or closed tenants cannot perform operations prohibited by the tenant lifecycle policy.
- Cross-tenant access must never be granted solely by supplying another tenant's identifier.

### 3.2 TenantMember

A `TenantMember` associates a user identity with a tenant and defines the member's platform-level role.

Attributes:

- `id`
- `tenant_id`
- `external_identity_id`
- `role`
- `status`
- `created_at`
- `updated_at`

Roles may include `owner`, `administrator`, `billing_manager`, `developer`, and `viewer`.

The model stores an external identity reference rather than implementing a full identity provider inside Tally.

### 3.3 CustomerAccount

A `CustomerAccount` represents the commercial customer responsible for a subscription or invoice.

Attributes:

- `id`
- `tenant_id`
- `external_customer_ref`
- `display_name`
- `email`
- `status`
- `created_at`
- `updated_at`

A customer account may represent a company, department, or other billing entity.

The relationship between tenant and customer must be explicit. A customer account does not automatically imply a login identity.

### 3.4 BillingProfile

A `BillingProfile` contains the billing-specific information associated with a customer.

Attributes:

- `id`
- `tenant_id`
- `customer_account_id`
- `legal_name`
- `billing_email`
- `billing_address`
- `tax_identifier`
- `default_currency`
- `created_at`
- `updated_at`

Tax identifiers and addresses must be protected as customer data.

The billing profile provides invoice information; it does not determine the price of a subscription.

## 4. Product Catalog

### 4.1 Product

A `Product` represents a SaaS service or billable offering.

Attributes:

- `id`
- `tenant_id`
- `code`
- `name`
- `description`
- `status`
- `created_at`
- `updated_at`

Products may be tenant-defined or platform-managed, depending on deployment configuration.

Product codes must be unique within their defined ownership scope.

### 4.2 Plan

A `Plan` represents a purchasable configuration of a product.

Attributes:

- `id`
- `tenant_id`
- `product_id`
- `code`
- `name`
- `description`
- `status`
- `created_at`
- `updated_at`

A plan defines the commercial package, but mutable plan metadata must not be the sole source of historical billing calculations.

A plan may reference multiple versioned prices over time.

### 4.3 PlanVersion

A `PlanVersion` captures a specific configuration of a plan.

Attributes:

- `id`
- `tenant_id`
- `plan_id`
- `version_number`
- `effective_from`
- `effective_until`
- `configuration`
- `created_at`

The configuration identifies the included entitlements and supported billing options for that version.

Published versions must be immutable. A change to a published configuration creates a new version.

The effective period must be unambiguous for the applicable subscription and billing context.

### 4.4 Price

A `Price` represents a versioned commercial price associated with a plan.

Attributes:

- `id`
- `tenant_id`
- `plan_id`
- `price_code`
- `currency`
- `billing_interval`
- `pricing_model`
- `effective_from`
- `effective_until`
- `configuration`
- `created_at`

Supported billing intervals initially include:

- Monthly
- Yearly
- One-time

Supported pricing models initially include:

- Flat recurring fee
- Per-unit usage
- Tiered usage
- Volume-based usage
- Included usage with overage
- One-time charge

Pricing configuration must define the relevant amount, unit, tiers, included quantities, rounding policy, and other required parameters for the selected model.

A published price version must not be modified in place. A new version must be created when the commercial terms change.

**Currency invariant:** Each price and invoice uses an explicit currency. The platform must not combine amounts in different currencies without an explicitly defined conversion process.

## 5. Subscription Domain

### 5.1 Subscription

A `Subscription` represents a customer's active or historical commercial relationship with a product plan.

Attributes:

- `id`
- `tenant_id`
- `customer_account_id`
- `product_id`
- `plan_id`
- `plan_version_id`
- `status`
- `started_at`
- `current_period_start`
- `current_period_end`
- `trial_ends_at`
- `cancel_at_period_end`
- `cancelled_at`
- `created_at`
- `updated_at`

Initial status values:

- `pending`
- `trialing`
- `active`
- `past_due`
- `paused`
- `cancelled`
- `expired`

Allowed transitions must be validated by the subscription domain.

A subscription references the applicable plan version and price configuration needed for billing. A plan's current configuration must not silently replace the terms of an existing subscription.

### 5.2 SubscriptionItem

A `SubscriptionItem` represents an individual billable component of a subscription.

Attributes:

- `id`
- `tenant_id`
- `subscription_id`
- `price_id`
- `quantity`
- `created_at`
- `updated_at`

This entity permits a subscription to contain multiple billable components, such as a recurring base plan and an additional seat allocation.

If the first implementation only permits one item per subscription, the model may enforce that constraint initially while preserving a clear extension path.

### 5.3 SubscriptionChange

A `SubscriptionChange` records a requested or completed commercial change.

Attributes:

- `id`
- `tenant_id`
- `subscription_id`
- `change_type`
- `effective_at`
- `previous_configuration`
- `new_configuration`
- `status`
- `created_at`
- `applied_at`

Change types may include plan upgrades, downgrades, quantity changes, pauses, resumptions, and cancellations.

Changes must specify their effective time and applicable proration policy. The platform must not infer retroactive pricing changes from the current catalog.

### 5.4 Subscription Invariants

- A subscription belongs to one customer account and tenant.
- Subscription lifecycle transitions are validated.
- Billing periods have valid, non-overlapping boundaries for the relevant subscription schedule.
- A cancelled subscription remains historically available for reporting and audit.
- Plan changes preserve the terms needed to explain charges before and after the change.
- Trial and cancellation rules must define whether and when entitlements remain available.

## 6. Usage Metering Domain

### 6.1 UsageMetric

A `UsageMetric` defines a measurable quantity that can be reported by an integrated application.

Attributes:

- `id`
- `tenant_id`
- `code`
- `name`
- `unit`
- `aggregation_method`
- `event_time_policy`
- `status`
- `created_at`
- `updated_at`

Initial aggregation methods:

- `sum`
- `count`
- `max`
- `last_value`

The implementation must define the mathematical and ordering semantics of each method. For example, `last_value` requires a deterministic ordering rule for events with equal timestamps.

Metric definitions referenced by historical usage must retain stable semantics. Changing a unit or aggregation rule must require a new metric version or an explicit migration.

### 6.2 UsageEvent

A `UsageEvent` represents an accepted report of consumption.

Attributes:

- `id`
- `tenant_id`
- `customer_account_id`
- `subscription_id`
- `metric_id`
- `external_event_id`
- `quantity`
- `occurred_at`
- `received_at`
- `dimensions`
- `source`
- `status`
- `created_at`

The external event identifier supports idempotent ingestion within a documented scope.

Dimensions provide bounded, validated metadata for usage attribution, such as a region or resource category. Dimensions must not be allowed to introduce uncontrolled high-cardinality indexes or unbounded payload growth.

Initial event statuses may include:

- `accepted`
- `rejected`

Duplicate submissions must be recognized through the idempotency mechanism and must not create a second billable event.

Rejected events must retain only the information needed for safe diagnostics and audit, according to the retention policy.

### 6.3 UsageAggregate

A `UsageAggregate` stores a derived summary of usage for a defined interval.

Attributes:

- `id`
- `tenant_id`
- `customer_account_id`
- `subscription_id`
- `metric_id`
- `period_start`
- `period_end`
- `aggregation_method`
- `value`
- `event_count`
- `calculated_at`
- `revision`

Aggregates are derived data, not substitutes for authoritative accepted events.

The aggregation process must define how it handles late-arriving events, duplicate processing, corrected events, and reprocessing.

Where corrections are permitted, a new aggregate revision or equivalent traceable correction mechanism must explain the change.

### 6.4 UsageEvent Invariants

- Every accepted event belongs to an identifiable tenant and valid metric.
- Quantity and timestamp validation follows the metric definition.
- Duplicate event identifiers within the deduplication scope do not increase consumption.
- Event occurrence time and receipt time remain distinct.
- Billing queries use explicitly defined event-time boundaries.
- Aggregates can be traced to the events or calculation inputs that produced them.

## 7. Entitlement Domain

### 7.1 EntitlementDefinition

An `EntitlementDefinition` describes a capability or allowance that may be granted to a subscription.

Attributes:

- `id`
- `tenant_id`
- `code`
- `name`
- `value_type`
- `description`
- `created_at`
- `updated_at`

Examples include:

- Access to a particular feature.
- Maximum number of team members.
- Maximum number of projects.
- Availability of an advanced integration.
- An included quantity of API requests.

The `value_type` defines the expected representation and validation rules for the entitlement value.

### 7.2 PlanEntitlement

A `PlanEntitlement` associates an entitlement definition with a plan version.

Attributes:

- `id`
- `tenant_id`
- `plan_version_id`
- `entitlement_definition_id`
- `value`
- `created_at`

This entity defines the default capabilities and allowances granted by a particular plan version.

### 7.3 EntitlementOverride

An `EntitlementOverride` records a controlled exception to the default entitlement configuration.

Attributes:

- `id`
- `tenant_id`
- `subscription_id`
- `entitlement_definition_id`
- `value`
- `reason`
- `effective_from`
- `effective_until`
- `created_by`
- `created_at`

Overrides require explicit authorization and an audit record.

The system must define precedence rules between plan defaults and overrides. Overrides must not silently bypass tenant suspension, security restrictions, or other mandatory platform policies.

### 7.4 Effective Entitlement

The effective entitlement is a calculated result, not necessarily a separately persisted record.

It is determined from:

1. The subscription's lifecycle state.
2. The applicable plan version.
3. Plan entitlement definitions.
4. Valid overrides.
5. Any mandatory platform restrictions.

The evaluation result must identify the effective value and enough context to explain why it was granted or denied.

## 8. Quota Domain

### 8.1 QuotaPolicy

A `QuotaPolicy` defines how a measurable resource is limited.

Attributes:

- `id`
- `tenant_id`
- `subscription_id`
- `metric_id`
- `limit_value`
- `window_type`
- `window_size`
- `enforcement_mode`
- `overage_policy`
- `created_at`
- `updated_at`

Initial window types may include:

- Billing period
- Calendar day
- Calendar month
- Rolling interval

The precise window boundaries and timezone must be explicit.

Enforcement modes may include:

- `strict`
- `eventual`

A strict quota requires concurrency-safe reservation or equivalent atomic enforcement. An eventual quota permits temporary overshoot due to delayed aggregation or concurrent requests.

The platform must not advertise eventual enforcement as a hard limit.

### 8.2 QuotaReservation

A `QuotaReservation` represents consumption provisionally reserved for an operation before final usage is reported.

Attributes:

- `id`
- `tenant_id`
- `subscription_id`
- `metric_id`
- `operation_id`
- `reserved_quantity`
- `committed_quantity`
- `status`
- `expires_at`
- `created_at`
- `updated_at`

Initial statuses:

- `reserved`
- `committed`
- `released`
- `expired`

Reservations must be idempotent for a given operation identifier and must have defined expiration and recovery rules.

Where strict quota enforcement is required, the quota decision and reservation must be atomic with respect to competing reservations.

## 9. Billing Domain

### 9.1 BillingPeriod

A `BillingPeriod` identifies the interval for which a subscription's charges are calculated.

Attributes:

- `id`
- `tenant_id`
- `subscription_id`
- `period_start`
- `period_end`
- `status`
- `calculation_version`
- `created_at`
- `completed_at`

Initial statuses:

- `pending`
- `processing`
- `completed`
- `failed`

A unique constraint must prevent multiple authoritative billing periods for the same subscription and billing schedule.

Billing-period boundaries must use a documented convention, preferably half-open intervals: the start is inclusive and the end is exclusive.

### 9.2 BillingCalculation

A `BillingCalculation` records the inputs and output of a charge calculation.

Attributes:

- `id`
- `tenant_id`
- `subscription_id`
- `billing_period_id`
- `pricing_version_reference`
- `usage_snapshot_reference`
- `currency`
- `subtotal`
- `discount_total`
- `tax_total`
- `total`
- `calculation_version`
- `status`
- `created_at`

The calculation must preserve enough information to reproduce the result, including the applicable price configuration, quantities, rounding rules, and adjustments.

A recalculation must not silently overwrite a finalized invoice. If a correction is necessary, the billing and invoicing workflows must determine whether a draft may be regenerated or a formal adjustment is required.

### 9.3 BillingAdjustment

A `BillingAdjustment` records a correction or commercial adjustment.

Attributes:

- `id`
- `tenant_id`
- `customer_account_id`
- `subscription_id`
- `invoice_id`
- `adjustment_type`
- `amount`
- `currency`
- `reason`
- `status`
- `created_by`
- `created_at`
- `applied_at`

Adjustment types may include credits, debits, discounts, and corrections.

An adjustment must have an explicit reason and authorization context. Once applied to a finalized invoice, its effect must remain auditable.

## 10. Invoicing Domain

### 10.1 Invoice

An `Invoice` represents a financial obligation issued to a customer.

Attributes:

- `id`
- `tenant_id`
- `customer_account_id`
- `billing_profile_snapshot`
- `invoice_number`
- `currency`
- `status`
- `issued_at`
- `due_at`
- `period_start`
- `period_end`
- `subtotal`
- `discount_total`
- `tax_total`
- `total`
- `amount_paid`
- `amount_due`
- `created_at`
- `updated_at`

Initial statuses:

- `draft`
- `issued`
- `partially_paid`
- `paid`
- `overdue`
- `void`

The transition rules must distinguish the invoice's lifecycle from the payment attempt lifecycle.

Invoice numbers must be unique within the defined issuing entity or tenant scope.

An issued invoice must retain a snapshot of the relevant customer billing details and finalized commercial calculations.

### 10.2 InvoiceLineItem

An `InvoiceLineItem` represents an individual charge, discount, or other invoice component.

Attributes:

- `id`
- `tenant_id`
- `invoice_id`
- `line_type`
- `description`
- `quantity`
- `unit_price`
- `amount`
- `currency`
- `source_type`
- `source_id`
- `metadata`

Line types may include:

- Recurring fee
- Usage charge
- One-time charge
- Discount
- Tax
- Adjustment

The source reference links a line item to its originating subscription item, billing calculation, usage summary, or adjustment.

Invoice line items must be stable after invoice issuance, subject to explicit correction workflows.

### 10.3 CreditNote

A `CreditNote` records a formal credit against an issued invoice where supported by the applicable billing and tax requirements.

Attributes:

- `id`
- `tenant_id`
- `customer_account_id`
- `invoice_id`
- `credit_note_number`
- `currency`
- `amount`
- `reason`
- `status`
- `issued_at`
- `created_at`

Credit notes are separate records rather than destructive edits to finalized invoice totals.

Whether a credit note reduces an outstanding balance, creates a customer credit, or initiates a refund must be explicitly represented in the relevant financial workflow.

## 11. Payment Domain

### 11.1 PaymentProviderAccount

A `PaymentProviderAccount` represents a configured connection to an external payment provider.

Attributes:

- `id`
- `tenant_id`
- `provider_code`
- `external_account_reference`
- `status`
- `configuration_reference`
- `created_at`
- `updated_at`

Sensitive provider credentials must be held in an appropriate secret store, not exposed through ordinary configuration APIs.

### 11.2 PaymentAttempt

A `PaymentAttempt` represents an attempt to collect payment for an invoice.

Attributes:

- `id`
- `tenant_id`
- `invoice_id`
- `provider_account_id`
- `idempotency_key`
- `amount`
- `currency`
- `status`
- `provider_reference`
- `failure_code`
- `created_at`
- `completed_at`

Initial statuses:

- `pending`
- `processing`
- `succeeded`
- `failed`
- `cancelled`
- `requires_action`

A payment attempt must not be assumed successful merely because a request was sent to the provider.

### 11.3 PaymentTransaction

A `PaymentTransaction` records a normalized financial transaction reported or verified by a payment provider.

Attributes:

- `id`
- `tenant_id`
- `invoice_id`
- `payment_attempt_id`
- `provider_transaction_reference`
- `transaction_type`
- `amount`
- `currency`
- `status`
- `occurred_at`
- `recorded_at`

Transaction types may include payment, refund, and reversal.

Provider transaction identifiers must be deduplicated within the appropriate provider account scope.

### 11.4 PaymentWebhookEvent

A `PaymentWebhookEvent` records an incoming provider callback for verification, deduplication, and processing.

Attributes:

- `id`
- `tenant_id`
- `provider_account_id`
- `provider_event_id`
- `event_type`
- `received_at`
- `verification_status`
- `processing_status`
- `processed_at`

The system must verify callback authenticity, reject or quarantine invalid callbacks, and prevent repeated delivery from causing duplicate financial transitions.

### 11.5 Payment Invariants

- Payment amounts and currencies must match the applicable invoice or explicitly supported partial-payment rules.
- Provider callbacks are not trusted until verified.
- Repeated callbacks must be idempotent.
- Payment status must be derived from verified transaction outcomes and reconciliation.
- Refunds and reversals must remain distinguishable from successful collections.
- Payment records must not silently rewrite finalized invoice line items.

## 12. Audit and Background Processing

### 12.1 AuditRecord

An `AuditRecord` captures a significant action or state transition.

Attributes:

- `id`
- `tenant_id`
- `actor_type`
- `actor_id`
- `action`
- `resource_type`
- `resource_id`
- `reason`
- `correlation_id`
- `metadata`
- `created_at`

Audit records must capture pricing changes, subscription transitions, entitlement overrides, quota changes, invoice issuance and voiding, credit notes, payment adjustments, and privileged administrative operations.

Sensitive credentials and unnecessary personal information must not be copied into audit metadata.

Audit records must be append-oriented. Corrections must be represented by additional records rather than silently rewriting history.

### 12.2 BackgroundJob

A `BackgroundJob` records durable asynchronous work.

Attributes:

- `id`
- `tenant_id`
- `job_type`
- `idempotency_key`
- `payload_reference`
- `status`
- `attempt_count`
- `available_at`
- `locked_at`
- `locked_by`
- `last_error_code`
- `created_at`
- `completed_at`

Initial statuses:

- `pending`
- `running`
- `completed`
- `retryable_failure`
- `permanent_failure`
- `cancelled`

Workers must claim jobs safely, handle expired locks, and avoid applying the same business operation twice.

A job's idempotency key must reflect the operation's business identity, not merely a random execution identifier.

## 13. Entity Relationships

The principal relationships are:

- A `Tenant` owns or scopes tenant-specific customer accounts, products, metrics, subscriptions, and operational records.
- A `CustomerAccount` has one or more billing profiles over time and may have multiple subscriptions.
- A `Product` contains one or more plans.
- A `Plan` has versioned configurations and prices.
- A `Subscription` references a customer, product, plan version, and one or more subscription items.
- A `SubscriptionItem` references a price configuration.
- A `UsageMetric` defines the interpretation of usage events.
- A `UsageEvent` belongs to a tenant and is attributed to the relevant customer, subscription, and metric where required.
- A `UsageAggregate` summarizes usage for a defined interval and attribution scope.
- A `PlanEntitlement` associates an entitlement definition with a plan version.
- An `EntitlementOverride` modifies the effective entitlement for an eligible subscription.
- A `QuotaPolicy` applies a consumption limit to a subscription and metric.
- A `QuotaReservation` records provisional consumption.
- A `BillingPeriod` belongs to a subscription and may have one or more calculation attempts, but only one authoritative completed billing result for the same billing obligation.
- A `BillingCalculation` produces the financial inputs used to construct an invoice.
- An `Invoice` belongs to a customer account and contains immutable-after-issuance line items.
- A `PaymentAttempt` references an invoice and provider account.
- A `PaymentTransaction` records a verified or reconciled transaction.
- An `AuditRecord` records a significant operation.
- A `BackgroundJob` represents durable asynchronous work.

## 14. Cross-Domain Invariants

The following invariants apply across module boundaries.

### Tenant isolation

Every tenant-owned resource must be accessed through an authorized tenant context. Foreign keys and application checks must prevent accidental cross-tenant relationships.

### Referential integrity

A subscription's customer, product, plan, and price references must be valid and compatible. A usage event cannot reference an unrelated tenant's subscription or metric.

### Historical pricing

Price changes affect eligible future operations according to their effective dates and subscription terms. They must not silently change finalized historical charges.

### Usage traceability

Billable usage must be traceable to accepted events, defined metric semantics, and the billing interval used in the calculation.

### Invoice integrity

Issued invoices must not be silently rewritten. Corrections use explicit adjustment, credit-note, void, or replacement workflows.

### Idempotent financial processing

Billing-period completion, invoice issuance, payment callbacks, and retryable financial jobs must have durable duplicate-prevention mechanisms.

### Explicit currency

Every monetary amount must carry or inherit an unambiguous currency from a validated parent record. Arithmetic across currencies is prohibited unless an explicit conversion operation is implemented.

### Time boundaries

Usage events, subscriptions, prices, and billing periods must use defined time semantics. Billing intervals must use inclusive start and exclusive end boundaries to avoid double-counting events at period transitions.

## 15. Implementation Guidance

- Use UUIDs or another consistent opaque identifier strategy for externally referenced entities.
- Use PostgreSQL constraints for uniqueness, valid references, and essential invariants.
- Store monetary values using integer minor units or a carefully specified exact decimal representation. Never use binary floating-point arithmetic for financial totals.
- Define currency precision and rounding rules explicitly.
- Use UTC for persisted timestamps and retain the relevant billing timezone where calendar-based billing requires it.
- Use versioned configuration records for prices and plan entitlements.
- Avoid embedding complex, frequently queried relationships exclusively in unvalidated JSON fields.
- Keep external provider references separate from internal identifiers.
- Use explicit domain enums and validated state-transition functions.
- Apply tenant scoping consistently to repositories and application services.
- Use database transactions for operations that must update related domain records atomically.
- Separate derived aggregates from authoritative source events.
- Add indexes based on actual query patterns, especially tenant-scoped time-range queries and idempotency lookups.

## 16. Open Design Decisions

The following choices must be resolved before finalizing the database schema:

1. Whether customer accounts are strictly tenant-owned or may be shared across tenant boundaries through an explicit organization hierarchy.
2. Whether catalog products and plans are global, tenant-specific, or support both scopes.
3. Whether usage ingestion accepts late events after a billing period closes, and how those events are corrected or charged.
4. Whether the first release supports only one subscription item or multiple items per subscription.
5. Which pricing models are required for the initial release.
6. Whether strict quotas are needed for every metric or only selected metrics.
7. Which tax calculations are supported and whether an external tax provider is required.
8. Whether invoice issuance and credit notes must comply with a particular jurisdiction's statutory requirements.
9. Which payment providers are required for the first release.
10. How long raw usage events, aggregates, audit records, and provider callbacks are retained.

These decisions must be documented before implementation rather than left to inconsistent assumptions across modules.

## 17. Next Document

The next document is `docs/architecture/database-design.md`. It will translate this domain model into PostgreSQL tables, keys, constraints, indexes, transaction boundaries, and migration conventions.