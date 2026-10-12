# Tally — Database Design

## 1. Purpose

This document defines the PostgreSQL schema strategy for the Tally. It translates the domain model into relational tables, keys, constraints, indexes, transaction boundaries, and migration conventions.

The database must support multi-tenant isolation, reliable usage ingestion, reproducible billing calculations, immutable issued invoices, and auditable payment processing.

## 2. Database Standards

### 2.1 Technology

- Database: PostgreSQL
- Primary identifiers: UUID
- Timestamps: `TIMESTAMPTZ`, stored in UTC
- Monetary values: exact decimal or integer minor units, never floating-point
- Usage quantities: `NUMERIC` where fractional quantities are supported
- Flexible configuration: `JSONB` only where schema flexibility is justified
- Schema changes: version-controlled migrations

### 2.2 Naming conventions

- Tables and columns use `snake_case`.
- Table names are plural.
- Primary keys use `id`.
- Foreign keys use the referenced entity name followed by `_id`.
- Creation and modification timestamps use `created_at` and `updated_at`.
- Business uniqueness is enforced through database constraints wherever practical.

### 2.3 Common tenant ownership

Most tenant-owned tables include `tenant_id UUID NOT NULL`.

Tenant ownership is not merely a filtering convention. The schema must make incompatible cross-tenant relationships difficult or impossible to create.

For relationships between tenant-owned records, use composite foreign keys where appropriate:

- Parent: `UNIQUE (tenant_id, id)`
- Child: `FOREIGN KEY (tenant_id, parent_id) REFERENCES parent (tenant_id, id)`

This pattern supplements application-level authorization with database-enforced ownership consistency.

## 3. Logical Schema Groups

| Schema group | Responsibility |
|---|---|
| Tenancy | Tenants, members, and customer accounts |
| Catalog | Products, plans, plan versions, prices, and metrics |
| Subscriptions | Subscriptions, items, and changes |
| Metering | Usage events, aggregation records, and processing checkpoints |
| Entitlements | Definitions, plan grants, and overrides |
| Quotas | Policies and reservations |
| Billing | Billing periods, calculations, and adjustments |
| Invoicing | Invoices, line items, and credit notes |
| Payments | Provider accounts, attempts, transactions, and callback events |
| Operations | Audit records, background jobs, and processing state |

Use PostgreSQL schemas only if they materially improve ownership or permissions. The initial deployment may use one database schema with consistent table prefixes or naming conventions.

## 4. Tenancy and Customer Tables

### 4.1 `tenants`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | TEXT | Not null |
| `slug` | TEXT | Not null, unique |
| `status` | TEXT | Not null, checked enum |
| `created_at` | TIMESTAMPTZ | Not null |
| `updated_at` | TIMESTAMPTZ | Not null |

Allowed statuses: `active`, `suspended`, `closed`.

### 4.2 `tenant_members`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Not null, tenant FK |
| `external_identity_id` | TEXT | Not null |
| `role` | TEXT | Not null |
| `status` | TEXT | Not null |
| `created_at` | TIMESTAMPTZ | Not null |
| `updated_at` | TIMESTAMPTZ | Not null |

Constraints:

- `UNIQUE (tenant_id, external_identity_id)`
- Index on `(tenant_id, role, status)`

Identity authentication remains external to this platform.

### 4.3 `customer_accounts`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Not null |
| `external_customer_ref` | TEXT | Nullable |
| `display_name` | TEXT | Not null |
| `email` | TEXT | Nullable |
| `status` | TEXT | Not null |
| `created_at` | TIMESTAMPTZ | Not null |
| `updated_at` | TIMESTAMPTZ | Not null |

Constraints:

- `UNIQUE (tenant_id, id)`
- Partial unique index on `(tenant_id, external_customer_ref)` when the reference is not null.
- Index on `(tenant_id, status, created_at DESC)`.

### 4.4 `billing_profiles`

Stores customer billing information separately from customer account identity.

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `customer_account_id UUID NOT NULL`
- `legal_name TEXT NOT NULL`
- `billing_email TEXT NOT NULL`
- `billing_address JSONB NOT NULL`
- `tax_identifier TEXT NULL`
- `default_currency CHAR(3) NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Use a composite foreign key to ensure the customer belongs to the same tenant.

If historical invoices must preserve prior billing details, copy the relevant details into an immutable invoice snapshot at issuance rather than relying on the current profile.

## 5. Catalog Tables

### 5.1 `products`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `code TEXT NOT NULL`
- `name TEXT NOT NULL`
- `description TEXT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraint: `UNIQUE (tenant_id, code)`.

This design assumes tenant-scoped catalogs initially. If global platform products are later required, introduce an explicit catalog ownership model rather than using a magic tenant identifier.

### 5.2 `plans`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `product_id UUID NOT NULL`
- `code TEXT NOT NULL`
- `name TEXT NOT NULL`
- `description TEXT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraints:

- `UNIQUE (tenant_id, id)`
- `UNIQUE (tenant_id, product_id, code)`
- Composite foreign key to `products (tenant_id, id)`.

### 5.3 `plan_versions`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `plan_id UUID NOT NULL`
- `version_number INTEGER NOT NULL`
- `effective_from TIMESTAMPTZ NOT NULL`
- `effective_until TIMESTAMPTZ NULL`
- `configuration JSONB NOT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`

Constraints:

- `UNIQUE (tenant_id, plan_id, version_number)`
- Composite foreign key to `plans`.
- `CHECK (effective_until IS NULL OR effective_until > effective_from)`.
- Published versions cannot be modified through ordinary update operations.

Prevent overlapping effective periods for the same plan where only one version may apply. PostgreSQL range types and exclusion constraints are suitable for this requirement.

### 5.4 `prices`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `plan_id UUID NOT NULL`
- `price_code TEXT NOT NULL`
- `version_number INTEGER NOT NULL`
- `currency CHAR(3) NOT NULL`
- `billing_interval TEXT NOT NULL`
- `pricing_model TEXT NOT NULL`
- `effective_from TIMESTAMPTZ NOT NULL`
- `effective_until TIMESTAMPTZ NULL`
- `configuration JSONB NOT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`

Constraints:

- `UNIQUE (tenant_id, plan_id, price_code, version_number)`
- Composite foreign key to the plan.
- Valid effective-period constraint.
- Valid billing interval and pricing model constraints.

The JSON configuration must be validated by a pricing-model-specific schema in the application. Database JSON validity alone is insufficient.

### 5.5 `usage_metrics`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `code TEXT NOT NULL`
- `name TEXT NOT NULL`
- `unit TEXT NOT NULL`
- `aggregation_method TEXT NOT NULL`
- `event_time_policy JSONB NOT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraint: `UNIQUE (tenant_id, code)`.

Changes to unit or aggregation semantics require a new version or explicit migration. Do not silently reinterpret historical events.

## 6. Subscription Tables

### 6.1 `subscriptions`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `customer_account_id UUID NOT NULL`
- `product_id UUID NOT NULL`
- `plan_id UUID NOT NULL`
- `plan_version_id UUID NOT NULL`
- `status TEXT NOT NULL`
- `started_at TIMESTAMPTZ NULL`
- `current_period_start TIMESTAMPTZ NULL`
- `current_period_end TIMESTAMPTZ NULL`
- `trial_ends_at TIMESTAMPTZ NULL`
- `cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE`
- `cancelled_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraints:

- Tenant-scoped composite foreign keys to customer, product, plan, and plan version.
- `CHECK` constraints for valid period boundaries.
- Index on `(tenant_id, customer_account_id, status)`.
- Index on `(tenant_id, status, current_period_end)` for lifecycle workers.

A database constraint cannot validate every cross-table semantic rule. Application services must verify that the referenced plan version belongs to the referenced plan and product.

### 6.2 `subscription_items`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `subscription_id UUID NOT NULL`
- `price_id UUID NOT NULL`
- `quantity NUMERIC(20,6) NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraints:

- Composite foreign keys to the subscription and price.
- `CHECK (quantity > 0)`.
- Index on `(tenant_id, subscription_id)`.

Price changes must normally create a new subscription-item version or a recorded subscription change, rather than mutating historical terms in place.

### 6.3 `subscription_changes`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `subscription_id UUID NOT NULL`
- `change_type TEXT NOT NULL`
- `effective_at TIMESTAMPTZ NOT NULL`
- `previous_configuration JSONB NOT NULL`
- `new_configuration JSONB NOT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `applied_at TIMESTAMPTZ NULL`

Index on `(tenant_id, subscription_id, effective_at DESC)`.

Record the actor and reason either directly or through a linked audit record.

## 7. Usage Metering Tables

Usage is likely to become one of the largest data domains. Design for idempotency, time-range queries, and controlled retention from the start.

### 7.1 `usage_events`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `customer_account_id UUID NOT NULL`
- `subscription_id UUID NULL`
- `metric_id UUID NOT NULL`
- `external_event_id TEXT NOT NULL`
- `quantity NUMERIC(24,8) NOT NULL`
- `occurred_at TIMESTAMPTZ NOT NULL`
- `received_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `dimensions JSONB NOT NULL DEFAULT '{}'`
- `source TEXT NOT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Constraints:

- Composite foreign keys enforce tenant consistency.
- `UNIQUE (tenant_id, external_event_id)` if event IDs are globally unique within a tenant.
- `CHECK (quantity >= 0)` if negative events are prohibited by the initial metric model.

If event identifiers are unique only per customer or per source, use the corresponding compound uniqueness scope instead. This must be decided before implementation.

Indexes:

- `(tenant_id, metric_id, occurred_at)`
- `(tenant_id, subscription_id, occurred_at)`
- `(tenant_id, customer_account_id, occurred_at)`
- A unique index for the idempotency key.

For high-volume ingestion, consider time-based partitioning once the expected event volume and retention requirements justify it. PostgreSQL partitioning affects unique constraints: the chosen partition key must be compatible with the uniqueness strategy, or a separate deduplication registry must be used.

### 7.2 `usage_aggregates`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `customer_account_id UUID NOT NULL`
- `subscription_id UUID NULL`
- `metric_id UUID NOT NULL`
- `period_start TIMESTAMPTZ NOT NULL`
- `period_end TIMESTAMPTZ NOT NULL`
- `aggregation_method TEXT NOT NULL`
- `value NUMERIC(24,8) NOT NULL`
- `event_count BIGINT NOT NULL`
- `revision INTEGER NOT NULL DEFAULT 1`
- `calculated_at TIMESTAMPTZ NOT NULL`

Constraints:

- `CHECK (period_end > period_start)`.
- `CHECK (event_count >= 0)`.
- Unique key over the chosen aggregation dimensions and revision strategy.

A common aggregate identity is tenant, customer, subscription, metric, period start, and period end. If nullable subscription IDs are allowed, use an explicit scope key or an appropriate unique-index strategy because ordinary PostgreSQL unique constraints treat nulls as distinct by default.

Index on `(tenant_id, metric_id, period_start, period_end)`.

### 7.3 Aggregation checkpoints

Use a dedicated checkpoint or processed-event table when required by the chosen aggregation algorithm.

For example, `usage_processing_checkpoints` may store:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `metric_id UUID NOT NULL`
- `partition_key TEXT NOT NULL`
- `last_processed_at TIMESTAMPTZ NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

A timestamp watermark alone is insufficient if events can arrive late. The implementation must define a replay window, explicit processed-event tracking, or a correction strategy.

## 8. Entitlement and Quota Tables

### 8.1 `entitlement_definitions`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `code TEXT NOT NULL`
- `name TEXT NOT NULL`
- `value_type TEXT NOT NULL`
- `description TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraint: `UNIQUE (tenant_id, code)`.

### 8.2 `plan_entitlements`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `plan_version_id UUID NOT NULL`
- `entitlement_definition_id UUID NOT NULL`
- `value JSONB NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`

Constraint: `UNIQUE (tenant_id, plan_version_id, entitlement_definition_id)`.

Validate the value against the entitlement definition's declared type.

### 8.3 `entitlement_overrides`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `subscription_id UUID NOT NULL`
- `entitlement_definition_id UUID NOT NULL`
- `value JSONB NOT NULL`
- `reason TEXT NOT NULL`
- `effective_from TIMESTAMPTZ NOT NULL`
- `effective_until TIMESTAMPTZ NULL`
- `created_by TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`

Index on `(tenant_id, subscription_id, effective_from, effective_until)`.

### 8.4 `quota_policies`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `subscription_id UUID NOT NULL`
- `metric_id UUID NOT NULL`
- `limit_value NUMERIC(24,8) NOT NULL`
- `window_type TEXT NOT NULL`
- `window_size INTEGER NULL`
- `enforcement_mode TEXT NOT NULL`
- `overage_policy TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraints:

- `CHECK (limit_value >= 0)`.
- Foreign keys enforce tenant consistency.
- Index on `(tenant_id, subscription_id, metric_id)`.

### 8.5 `quota_reservations`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `subscription_id UUID NOT NULL`
- `metric_id UUID NOT NULL`
- `operation_id TEXT NOT NULL`
- `reserved_quantity NUMERIC(24,8) NOT NULL`
- `committed_quantity NUMERIC(24,8) NOT NULL DEFAULT 0`
- `status TEXT NOT NULL`
- `expires_at TIMESTAMPTZ NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraints:

- `UNIQUE (tenant_id, operation_id)` when operation IDs are tenant-wide unique.
- `CHECK (reserved_quantity >= 0)`.
- `CHECK (committed_quantity >= 0)`.
- Index on `(tenant_id, subscription_id, metric_id, status, expires_at)`.

Strict enforcement must use transactions and concurrency-safe reservations. Merely reading the current aggregate and then inserting a reservation is vulnerable to concurrent oversubscription.

## 9. Billing Tables

### 9.1 `billing_periods`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `subscription_id UUID NOT NULL`
- `period_start TIMESTAMPTZ NOT NULL`
- `period_end TIMESTAMPTZ NOT NULL`
- `status TEXT NOT NULL`
- `calculation_version INTEGER NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `completed_at TIMESTAMPTZ NULL`

Constraints:

- `CHECK (period_end > period_start)`.
- Unique key on `(tenant_id, subscription_id, period_start, period_end)`.
- Index on `(tenant_id, status, period_end)`.

### 9.2 `billing_calculations`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `subscription_id UUID NOT NULL`
- `billing_period_id UUID NOT NULL`
- `pricing_version_reference JSONB NOT NULL`
- `usage_snapshot_reference JSONB NOT NULL`
- `currency CHAR(3) NOT NULL`
- `subtotal NUMERIC(20,4) NOT NULL`
- `discount_total NUMERIC(20,4) NOT NULL`
- `tax_total NUMERIC(20,4) NOT NULL`
- `total NUMERIC(20,4) NOT NULL`
- `calculation_version INTEGER NOT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`

Use a dedicated immutable calculation-input snapshot when a JSON reference alone would not preserve the exact pricing rules and quantities used.

Enforce a clear distinction between draft calculations, completed calculations, and calculations superseded by a later authorized correction.

### 9.3 `billing_adjustments`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `customer_account_id UUID NOT NULL`
- `subscription_id UUID NULL`
- `invoice_id UUID NULL`
- `adjustment_type TEXT NOT NULL`
- `amount NUMERIC(20,4) NOT NULL`
- `currency CHAR(3) NOT NULL`
- `reason TEXT NOT NULL`
- `status TEXT NOT NULL`
- `created_by TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `applied_at TIMESTAMPTZ NULL`

Index on `(tenant_id, customer_account_id, created_at DESC)`.

An adjustment must not silently alter an issued invoice. Its application must follow the invoice lifecycle and correction policy.

## 10. Invoice Tables

### 10.1 `invoices`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `customer_account_id UUID NOT NULL`
- `billing_period_id UUID NULL`
- `invoice_number TEXT NOT NULL`
- `billing_profile_snapshot JSONB NOT NULL`
- `currency CHAR(3) NOT NULL`
- `status TEXT NOT NULL`
- `issued_at TIMESTAMPTZ NULL`
- `due_at TIMESTAMPTZ NULL`
- `period_start TIMESTAMPTZ NULL`
- `period_end TIMESTAMPTZ NULL`
- `subtotal NUMERIC(20,4) NOT NULL`
- `discount_total NUMERIC(20,4) NOT NULL`
- `tax_total NUMERIC(20,4) NOT NULL`
- `total NUMERIC(20,4) NOT NULL`
- `amount_paid NUMERIC(20,4) NOT NULL DEFAULT 0`
- `amount_due NUMERIC(20,4) NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Constraints:

- `UNIQUE (tenant_id, invoice_number)`.
- Composite foreign key to the customer account.
- `CHECK (period_end IS NULL OR period_start IS NULL OR period_end > period_start)`.
- Nonnegative amount constraints where negative invoices are not supported.

For automatically generated subscription invoices, enforce a unique billing obligation. If only one invoice is permitted per billing period, use a unique constraint on `(tenant_id, billing_period_id)` where `billing_period_id IS NOT NULL`. If multiple invoices per period are permitted, introduce a separate billing-obligation identifier.

Indexes:

- `(tenant_id, customer_account_id, created_at DESC)`
- `(tenant_id, status, due_at)`
- `(tenant_id, issued_at DESC)`

Invoice totals must be reconciled against their line items within the same currency and documented rounding rules.

### 10.2 `invoice_line_items`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `invoice_id UUID NOT NULL`
- `line_type TEXT NOT NULL`
- `description TEXT NOT NULL`
- `quantity NUMERIC(24,8) NOT NULL`
- `unit_price NUMERIC(20,8) NOT NULL`
- `amount NUMERIC(20,4) NOT NULL`
- `currency CHAR(3) NOT NULL`
- `source_type TEXT NULL`
- `source_id UUID NULL`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL`

Index on `(tenant_id, invoice_id)`.

The application must validate that each line item currency matches the invoice currency. A polymorphic `source_type`/`source_id` pair cannot be enforced with an ordinary foreign key; use domain validation or explicit nullable foreign keys for supported source types.

After issuance, line items must be immutable through normal application operations.

### 10.3 `credit_notes`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `customer_account_id UUID NOT NULL`
- `invoice_id UUID NOT NULL`
- `credit_note_number TEXT NOT NULL`
- `currency CHAR(3) NOT NULL`
- `amount NUMERIC(20,4) NOT NULL`
- `reason TEXT NOT NULL`
- `status TEXT NOT NULL`
- `issued_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL`

Constraints:

- `UNIQUE (tenant_id, credit_note_number)`.
- Foreign keys to invoice and customer.
- `CHECK (amount > 0)`.

If credit notes require their own line-level tax treatment, introduce `credit_note_line_items` rather than representing all details in a single amount field.

## 11. Payment Tables

### 11.1 `payment_provider_accounts`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `provider_code TEXT NOT NULL`
- `external_account_reference TEXT NULL`
- `status TEXT NOT NULL`
- `configuration_reference TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Credentials must be stored in a secrets system. The database must contain only the secure reference and non-sensitive configuration required to identify the connection.

### 11.2 `payment_attempts`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `invoice_id UUID NOT NULL`
- `provider_account_id UUID NOT NULL`
- `idempotency_key TEXT NOT NULL`
- `amount NUMERIC(20,4) NOT NULL`
- `currency CHAR(3) NOT NULL`
- `status TEXT NOT NULL`
- `provider_reference TEXT NULL`
- `failure_code TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `completed_at TIMESTAMPTZ NULL`

Constraints:

- `UNIQUE (tenant_id, provider_account_id, idempotency_key)`.
- Index on `(tenant_id, invoice_id, created_at DESC)`.
- Index on `(tenant_id, status, created_at)` for reconciliation workers.

### 11.3 `payment_transactions`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `invoice_id UUID NOT NULL`
- `payment_attempt_id UUID NULL`
- `provider_transaction_reference TEXT NOT NULL`
- `transaction_type TEXT NOT NULL`
- `amount NUMERIC(20,4) NOT NULL`
- `currency CHAR(3) NOT NULL`
- `status TEXT NOT NULL`
- `occurred_at TIMESTAMPTZ NULL`
- `recorded_at TIMESTAMPTZ NOT NULL`

Constraint: unique provider transaction reference within the provider account's scope.

Include a provider-account reference directly or enforce the scope through the payment attempt, according to the selected reconciliation model. Do not assume provider transaction identifiers are globally unique across all providers and merchant accounts.

### 11.4 `payment_webhook_events`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `provider_account_id UUID NOT NULL`
- `provider_event_id TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `received_at TIMESTAMPTZ NOT NULL`
- `verification_status TEXT NOT NULL`
- `processing_status TEXT NOT NULL`
- `processed_at TIMESTAMPTZ NULL`
- `payload_reference TEXT NULL`

Constraint: `UNIQUE (tenant_id, provider_account_id, provider_event_id)`.

Store raw callback payloads only when necessary. Restrict access, redact sensitive values, and apply a defined retention policy. A hash or reference to a secure payload store may be sufficient for many deployments.

## 12. Audit and Background Jobs

### 12.1 `audit_records`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NULL`
- `actor_type TEXT NOT NULL`
- `actor_id TEXT NULL`
- `action TEXT NOT NULL`
- `resource_type TEXT NOT NULL`
- `resource_id TEXT NOT NULL`
- `reason TEXT NULL`
- `correlation_id TEXT NULL`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL`

Indexes:

- `(tenant_id, created_at DESC)`
- `(tenant_id, resource_type, resource_id, created_at DESC)`
- `(tenant_id, actor_id, created_at DESC)`

Platform-wide administrative actions may not have a tenant context, so `tenant_id` can be nullable only for explicitly authorized platform operations.

### 12.2 `background_jobs`

Important columns:

- `id UUID PRIMARY KEY`
- `tenant_id UUID NULL`
- `job_type TEXT NOT NULL`
- `idempotency_key TEXT NOT NULL`
- `payload JSONB NOT NULL`
- `status TEXT NOT NULL`
- `attempt_count INTEGER NOT NULL DEFAULT 0`
- `available_at TIMESTAMPTZ NOT NULL`
- `locked_at TIMESTAMPTZ NULL`
- `locked_by TEXT NULL`
- `last_error_code TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `completed_at TIMESTAMPTZ NULL`

Constraints and indexes:

- A unique key for the business operation represented by `job_type` and `idempotency_key`.
- Index on `(status, available_at)` for worker polling.
- Index on `(locked_at)` for expired-lock recovery.
- Index on `(tenant_id, created_at DESC)` for tenant-scoped diagnostics.

The uniqueness scope must be consistent with whether job identifiers are globally unique or tenant-scoped.

## 13. Transaction Boundaries

### Usage ingestion

Within one transaction:

1. Validate tenant and event references.
2. Insert the usage event using the agreed idempotency key.
3. Record any durable processing work needed for aggregation.

If the event is a duplicate, return the previously established outcome without creating additional usage.

### Strict quota reservation

Within one concurrency-safe transaction:

1. Resolve the applicable quota policy.
2. Lock or atomically update the appropriate quota state.
3. Evaluate existing committed consumption and active reservations.
4. Reserve the requested quantity only if the limit permits it.
5. Commit the reservation and its idempotency identity.

Concurrent requests must not independently observe the same remaining allowance and both exceed a strict limit.

### Billing-period processing

1. Create or claim the billing period using its unique business identity.
2. Capture stable pricing and usage inputs.
3. Calculate charges deterministically.
4. Persist the calculation result.
5. Create the invoice and line items in a transaction when the billing operation is ready.
6. Mark the billing obligation complete only after its required records have been committed.

Long-running external calls must not be performed while holding database transactions open.

### Invoice issuance

Within a transaction:

1. Lock the draft invoice.
2. Validate line items, currency, totals, and required billing details.
3. Allocate the invoice number using a concurrency-safe mechanism.
4. Persist the immutable issued state and audit record.
5. Commit.

Use a dedicated counter table or another transactional numbering mechanism if sequential invoice numbers are legally or operationally required. A PostgreSQL sequence alone can contain gaps after rollbacks.

### Payment callbacks

1. Verify callback authenticity before accepting its financial meaning.
2. Insert the provider event using a deduplication constraint.
3. Record the verified transaction outcome.
4. Update payment and invoice balance state through a controlled application workflow.
5. Commit the database changes.
6. Schedule any follow-up notifications or reconciliation work durably.

Repeated callbacks must not create duplicate transactions or apply the same payment twice.

## 14. Tenant Isolation at the Database Layer

Application-level tenant authorization is mandatory. PostgreSQL Row-Level Security (RLS) may provide additional defense in depth.

If RLS is enabled:

- Define policies for each tenant-owned table.
- Set the tenant context transaction-locally.
- Use a restricted application database role.
- Avoid shared connection state that could leak tenant context between requests.
- Test pooled connections and transaction rollback behavior.
- Ensure privileged jobs use explicit, audited access paths.

RLS does not replace correct authorization or safe query construction.

## 15. Financial Precision and Currency

The implementation must choose one canonical monetary representation.

Recommended initial approach:

- Store monetary amounts using exact `NUMERIC` types with explicitly defined scale.
- Define currency-specific minor-unit precision.
- Apply rounding at documented calculation boundaries.
- Keep quantities and unit prices at sufficient precision for usage calculations.
- Round invoice line totals according to the configured policy.
- Reconcile invoice totals against line items and adjustments.
- Never use JavaScript `number` arithmetic as the authoritative financial calculation mechanism for arbitrary decimal values.

NestJS services must use a decimal arithmetic library or a carefully tested integer-minor-unit model. API serialization must preserve exact monetary values, commonly as decimal strings.

The schema's chosen precision and scale must be verified against supported currencies and pricing models before release.

## 16. Data Retention and Performance

The platform must establish retention policies for:

- Raw usage events.
- Usage aggregates.
- Idempotency records.
- Payment callback payloads.
- Background-job payloads and error details.
- Audit records.
- Invoice and payment records.

Financial and audit retention may be subject to legal requirements. Do not automatically delete records merely because they are old.

For large usage tables:

- Begin with tenant/time-range indexes and measured query plans.
- Monitor table growth, write amplification, and index size.
- Introduce time-based partitioning when volume justifies it.
- Keep deduplication correct across partitions.
- Use archival or retention jobs with explicit safety checks.
- Avoid indexing every JSONB dimension by default.

## 17. Migration Strategy

All schema changes must be version-controlled and reproducible.

Requirements:

- Every migration has a unique, ordered identifier.
- Migrations are tested against the supported PostgreSQL version.
- Destructive changes use an expand-and-contract approach.
- Large backfills run as controlled jobs rather than long-running schema migrations.
- Indexes on large production tables use an appropriate online strategy, such as concurrent index creation where supported.
- Database migration privileges are separate from ordinary application privileges where practical.
- Deployment procedures account for application versions that overlap during rollout.
- Backup restoration and migration rollback limitations are documented.

Never assume that reversing a schema migration can restore deleted production data.

## 18. Required Database Tests

Automated tests must cover:

- Tenant-scoped foreign-key integrity.
- Duplicate usage-event rejection.
- Concurrent strict quota reservations.
- Valid and invalid subscription transitions.
- Non-overlapping applicable price and plan versions.
- Billing-period uniqueness under concurrent workers.
- Invoice creation idempotency.
- Invoice totals matching line items.
- Immutability of issued invoices through ordinary update paths.
- Duplicate payment callback handling.
- Provider transaction deduplication.
- Cross-tenant access prevention.
- Expired background-job lock recovery.
- Migration execution against a clean database.
- Upgrade migrations against a database containing representative historical data.

Use PostgreSQL through Testcontainers for integration tests where correctness depends on actual database constraints, locking, isolation, or indexing behavior.

## 19. Design Decisions Required Before Implementation

The following must be finalized before writing the initial migrations:

1. Usage-event deduplication scope.
2. Whether raw usage events will be partitioned in the first release.
3. Whether catalogs are tenant-specific or support global definitions.
4. The exact price-versioning and effective-date constraints.
5. Monetary precision, supported currencies, and rounding rules.
6. Whether multiple invoices may arise from one billing period.
7. The invoice-numbering requirements for each deployment jurisdiction.
8. The quota reservation and locking strategy.
9. Whether RLS is enabled from the first migration.
10. Retention rules for usage, payment callback, and audit data.

These decisions affect constraints and data migrations, so they must not be deferred until production data exists.

## 20. Next Document

The next document is `docs/architecture/usage-metering-and-aggregation.md`. It will specify event ingestion, idempotency, event-time semantics, aggregation algorithms, late-arriving events, correction handling, and usage reporting.