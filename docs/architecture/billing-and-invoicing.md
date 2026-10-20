# Billing and Invoicing

**Path:** `docs/architecture/billing-and-invoicing.md`

**Status:** Approved  
**Project:** Tally  
**Architecture:** Modular monolith with separately runnable API and worker processes

## 1. Purpose

This document defines how the platform converts subscriptions, recurring fees, metered consumption, and approved adjustments into accurate, auditable financial records.

The billing subsystem is responsible for calculating amounts owed, issuing invoices, tracking payments, managing credits, and reconciling financial activity. It must preserve financial history even when subscriptions change, usage is corrected, payments fail, or external providers deliver duplicate events.

### Goals

- Calculate recurring and usage-based charges accurately.
- Support multiple pricing models and billing intervals.
- Generate immutable, auditable invoices.
- Handle upgrades, downgrades, prorations, credits, and adjustments.
- Integrate with external payment providers through adapters.
- Process payment events idempotently.
- Reconcile internal records against external provider transactions.
- Support retries, failed payments, refunds, and disputes.
- Maintain clear boundaries between commercial subscriptions, usage metering, billing, and the financial ledger.

### Non-goals

This document does not define subscription lifecycle transitions, quota enforcement, or the implementation of a general-purpose financial ledger. Those concerns remain in their respective modules.

The initial implementation is a billing subdomain, not a replacement for a regulated accounting system or a full double-entry general ledger.

## 2. Architectural boundaries

| Component | Responsibility |
|---|---|
| Catalog | Defines plans, prices, and pricing models. |
| Subscription | Records the customer's commercial agreement. |
| Usage metering | Records and aggregates measurable consumption. |
| Quota enforcement | Controls whether consumption is permitted. |
| Billing | Calculates charges, credits, balances, and invoice totals. |
| Payment integration | Communicates with external payment providers. |
| Financial ledger | Records accounting entries if a separate ledger integration is required. |
| Notifications | Sends invoice, payment, and collection communications. |

Billing consumes authoritative inputs from the subscription and metering domains. It must not independently reconstruct subscription states or invent usage totals.

Payment providers facilitate collection. Their status values do not replace the platform's internal invoice and payment records.

## 3. Core financial principles

1. **Exact arithmetic:** use integer minor units or exact decimal arithmetic, never binary floating-point arithmetic.
2. **Immutable issued documents:** issued invoices are not edited in place.
3. **Explicit corrections:** correct financial mistakes through credit notes, debit adjustments, or other documented adjustment records.
4. **Idempotent processing:** retries must not create duplicate invoices, charges, credits, or payment records.
5. **Currency consistency:** each financial amount has an explicit currency.
6. **Traceable calculations:** every invoice line can be traced to its source and pricing rule.
7. **Transactional integrity:** financial records and their corresponding outbox events are committed together.
8. **Provider independence:** domain logic must not depend on a specific payment provider's API model.
9. **Auditable history:** every material financial transition has an actor or system cause, timestamp, and correlation reference.
10. **No silent reconciliation:** discrepancies must be recorded and resolved through explicit workflows.

## 4. Supported pricing models

The initial design must support the following models without requiring separate billing services.

### 4.1 Flat recurring fee

A fixed amount is charged for each billing period.

Example: a subscription costs 100 currency units per month.

The price version determines the amount, currency, interval, and effective commercial terms.

### 4.2 Per-unit pricing

The customer is charged for each billable unit.

Examples include active seats, managed devices, or registered resources.

The billing calculation must identify the billable quantity and its source. The platform must define whether quantity is measured at a point in time, averaged across a period, or calculated from events.

### 4.3 Metered usage

Charges are calculated from usage aggregates, such as API calls, storage consumption, or processing time.

The billing module consumes finalized or explicitly billable usage records. It must not assume that every operational metric is billable.

### 4.4 Tiered pricing

Different portions of consumption may have different rates.

Two supported concepts must be distinguished:

- **Graduated tiers:** each portion of consumption is charged at the rate for its tier.
- **Volume tiers:** the applicable tier's rate applies to all qualifying units.

The pricing configuration must specify which model applies. The implementation must not infer the model from tier boundaries.

### 4.5 Minimums and included allowances

A price may include an allowance or a minimum charge.

The billing engine must define whether the allowance is deducted before tier calculations and whether the minimum applies before or after discounts and credits.

These rules must be explicit in the pricing configuration and tested at boundaries.

### 4.6 One-time charges

One-time charges may cover setup, activation, or a separately purchased service.

They must reference an approved price or charge definition and a unique originating operation.

### 4.7 Initial scope limitations

The first release must prioritize:

- Flat recurring charges.
- Per-unit charges.
- Metered usage.
- One-time charges.
- Credits and explicit adjustments.
- Basic discounts where their calculation rules are well-defined.

Advanced taxation, complex contract negotiation, foreign-exchange conversion, and highly customized enterprise billing must be added only after their requirements are established.

## 5. Billing period and calculation rules

### 5.1 Billing periods

A subscription supplies the authoritative billing-period boundaries.

The billing engine must support monthly and annual intervals initially. Additional intervals can be introduced through versioned pricing configuration.

Calendar arithmetic must define month-end behavior explicitly. A monthly subscription anchored on the 31st must follow a consistent rule for months without that day.

Store period boundaries in UTC and retain the original billing timezone where local calendar rules affect commercial terms.

### 5.2 Price snapshots

Each invoice line must retain the price information used to calculate it, including:

- Price version.
- Currency.
- Unit price.
- Billable quantity.
- Billing interval or usage period.
- Pricing model.
- Applicable discount or allowance.
- Calculation-rule version.

A later catalog price change must not alter an already issued invoice.

### 5.3 Proration

Proration applies when a plan or quantity changes partway through a billing period.

The initial implementation must support an explicitly selected policy:

- No proration until the next billing period.
- Immediate proration using elapsed time.
- Immediate proration using remaining whole days.

Do not mix these policies within a calculation.

For time-based proration, define the interval convention and rounding policy. For example, a policy may calculate the fraction of a billing period using elapsed seconds:

\[
\text{Prorated amount}
=
\text{Period price}
\times
\frac{\text{Eligible duration}}{\text{Total period duration}}
\]

This is a calculation model, not a universal rule. The actual denominator and eligible duration must follow the accepted commercial terms.

Proration must create traceable invoice lines or adjustments rather than overwrite previous charges.

### 5.4 Discounts and credits

A discount modifies a charge according to a defined commercial rule. A credit reduces an amount otherwise payable or carries a balance under a defined policy.

The billing engine must distinguish:

- Percentage discounts.
- Fixed-amount discounts.
- Promotional discounts with effective dates.
- Account credit balances.
- Credit notes correcting previously issued invoices.

Define the order of calculation. A recommended default is to calculate eligible line amounts, apply line-level discounts, calculate subtotal, apply eligible invoice-level discounts, and then calculate applicable taxes. The order may differ where legal or contractual rules require it.

Do not treat a credit note as interchangeable with an unapplied customer credit balance.

## 6. Monetary precision and rounding

Represent financial amounts using integer minor units or an exact decimal type.

Each currency must have a configured precision. Do not assume every currency has two decimal places.

The billing engine must specify:

- Precision used for unit prices and intermediate calculations.
- Rounding mode.
- Rounding stage.
- Treatment of fractional billable quantities.
- Treatment of negative adjustments.
- Allocation of rounding residuals across invoice lines.

For invoice totals, use one consistent rule, such as rounding each line to the currency's minor-unit precision and summing the resulting line totals. If the product requires a different rule, document and test it.

Never use floating-point values as the source of truth for monetary amounts.

## 7. Billing data model

### 7.1 Billing account

A billing account represents the entity responsible for payment.

Fields:

- `id`
- `tenant_id`
- `customer_id`
- `billing_email`
- `billing_address`
- `default_currency`
- `payment_terms`
- `status`
- `created_at`
- `updated_at`

Separate customer identity from billing identity so the platform can later support multiple billing accounts or legal entities per tenant.

The initial implementation may enforce one billing account per tenant, but this must be an explicit business constraint rather than an assumption embedded throughout the domain.

### 7.2 Invoice

Fields:

- `id`
- `tenant_id`
- `billing_account_id`
- `invoice_number`
- `currency`
- `status`
- `issue_date`
- `due_date`
- `service_period_start`
- `service_period_end`
- `subtotal_minor`
- `discount_minor`
- `tax_minor`
- `total_minor`
- `amount_paid_minor`
- `amount_credited_minor`
- `amount_due_minor`
- `issued_at`
- `finalized_at`
- `created_at`

The schema must clearly distinguish draft calculations from issued financial documents.

Invoice numbers must be unique within the defined legal or business numbering scope. Do not use a database row ID as the only customer-facing invoice number.

### 7.3 Invoice line

Fields:

- `id`
- `invoice_id`
- `line_number`
- `description`
- `line_type`
- `source_type`
- `source_id`
- `price_version_id`
- `quantity`
- `unit`
- `unit_price`
- `currency`
- `gross_amount_minor`
- `discount_amount_minor`
- `tax_amount_minor`
- `net_amount_minor`
- `service_period_start`
- `service_period_end`
- `calculation_metadata`

An invoice line must preserve enough information to explain how its amount was calculated.

The source may be a subscription period, usage aggregate, one-time charge, proration operation, or approved adjustment.

### 7.4 Payment

A payment record tracks an attempted or completed collection.

Fields:

- `id`
- `tenant_id`
- `billing_account_id`
- `provider`
- `provider_payment_id`
- `idempotency_key`
- `currency`
- `amount_minor`
- `status`
- `initiated_at`
- `confirmed_at`
- `failed_at`
- `failure_code`
- `created_at`
- `updated_at`

Use a unique constraint for the provider and provider payment identifier where the provider supplies one.

### 7.5 Payment allocation

Payments and invoices must be linked through an explicit allocation model rather than assuming one payment always belongs to one invoice.

Fields:

- `id`
- `payment_id`
- `invoice_id`
- `amount_minor`
- `currency`
- `created_at`

This supports partial payments, one payment settling multiple invoices, and controlled allocation changes.

The initial user-facing workflow may restrict a payment to one invoice, but the data model must not make broader allocation impossible.

### 7.6 Credit note

A credit note records a formal reduction to an issued invoice.

Fields:

- `id`
- `tenant_id`
- `invoice_id`
- `credit_note_number`
- `currency`
- `reason_code`
- `subtotal_minor`
- `tax_minor`
- `total_minor`
- `status`
- `issued_at`
- `created_at`

Credit-note lines must reference the original invoice lines where appropriate.

A credit note must not exceed the remaining legally or commercially creditable amount unless an explicitly authorized policy permits a different treatment.

### 7.7 Customer credit balance

Where account credits are supported, represent credit balances through an append-only credit transaction history.

Transactions may include:

- Credit granted.
- Credit applied to an invoice.
- Credit reversed.
- Credit expired under an explicitly defined policy.

Maintain a balance projection for efficient reads, but preserve the underlying transaction history.

### 7.8 Billing operation

Use a durable billing-operation record to coordinate multi-step workflows.

Fields:

- `id`
- `tenant_id`
- `operation_type`
- `source_type`
- `source_id`
- `idempotency_key`
- `status`
- `attempt_count`
- `last_error_code`
- `created_at`
- `updated_at`

A uniqueness constraint must prevent the same billable source and operation from being processed more than once unintentionally.

## 8. Invoice lifecycle

### 8.1 States

| State | Meaning |
|---|---|
| `draft` | Invoice is being assembled and can be recalculated. |
| `open` | Invoice has been issued and remains payable. |
| `paid` | The invoice has been fully settled under the applicable allocation policy. |
| `partially_paid` | Some payment has been allocated, but a balance remains. |
| `void` | The invoice has been voided under an authorized, documented policy. |
| `uncollectible` | The balance has been classified as uncollectible without erasing the debt history. |

A separate status or derived view may track overdue invoices. Avoid conflating overdue state with the underlying payment transaction state.

### 8.2 Draft invoices

Draft invoices may be recalculated as eligible usage, subscription terms, or adjustments become available.

Draft invoice operations must be idempotent and must not produce externally payable documents until issuance succeeds.

### 8.3 Issuance

Issuance is a financial boundary.

Before issuing an invoice, validate:

- Billing account and customer identity.
- Currency consistency.
- Source records and service periods.
- Pricing and calculation-rule versions.
- Line arithmetic and invoice totals.
- Discount and credit eligibility.
- Required tax information under the configured policy.
- Unique invoice-number allocation.

After issuance, the financial contents are immutable.

If a correction is required, create an authorized adjustment or credit note. Do not directly modify issued invoice totals or lines.

### 8.4 Void and correction

Voiding an issued invoice must follow a documented policy and preserve the original record.

Where a formal credit note is required, use that mechanism rather than treating a void operation as deletion.

An invoice marked uncollectible must remain auditable and must not automatically become paid.

## 9. Invoice generation workflow

Recurring and usage-based invoice generation must be executed by durable background jobs.

Recommended workflow:

1. Identify a due billing period or billable source.
2. Create or retrieve the billing operation using its idempotency key.
3. Resolve the billing account and applicable subscription terms.
4. Load the correct immutable price versions.
5. Collect eligible usage aggregates and adjustments.
6. Calculate invoice lines and totals.
7. Validate currency, rounding, and pricing rules.
8. Create a draft invoice and its lines transactionally.
9. Validate and issue the invoice.
10. Commit invoice records, audit entries, and outbox events.
11. Trigger notifications and, where configured, payment collection.

The operation must be recoverable after failure at any step.

A retry must resume or safely reconstruct the same logical billing operation instead of producing a second invoice.

### 9.1 Invoice uniqueness

Define a stable invoice-generation key based on the relevant billing account, billing period, invoice purpose, and any necessary source identifier.

The database must enforce the applicable uniqueness rule.

Do not rely solely on checking for an existing invoice in application code before inserting a new one; concurrent workers may both pass the check.

### 9.2 Usage finalization

The billing policy must define when usage becomes billable.

Possible policies include:

- Finalize at the end of a billing period.
- Finalize after a defined late-event window.
- Issue an initial invoice and correct later differences through explicit adjustments.

Late usage must not silently change an issued invoice. Corrections must create additional auditable financial records.

## 10. Payment-provider integration

### 10.1 Provider adapter

Define an internal payment-provider interface so the billing domain does not depend on a provider-specific SDK or payload.

The interface must support operations such as:

- Create a payment or collection request.
- Retrieve payment status.
- Initiate a refund where supported.
- Verify incoming provider notifications.
- Retrieve provider transaction references.
- Reconcile transactions for a defined period.

Provider-specific behavior belongs in adapter implementations.

Credentials belong to the tenant, not the platform. Each tenant connects its own provider account. Secret keys must be encrypted at rest with an application-held encryption key, must never be returned by an API, and must never appear in logs or audit metadata.

### 10.2 Payment workflow

A typical payment workflow is:

1. Create an internal payment attempt.
2. Generate an idempotency key.
3. Request collection from the provider.
4. Store the provider reference and current known state.
5. Receive a signed webhook or retrieve authoritative provider status.
6. Verify and normalize the result.
7. Update the payment record transactionally.
8. Allocate confirmed funds to the relevant invoice or account.
9. Recalculate the invoice's outstanding balance.
10. Emit a durable event and send notifications.

Do not mark an invoice paid merely because a client reports that payment succeeded or a payment initiation request returned successfully.

### 10.3 Webhook verification

Provider notifications must be verified using the provider's documented signature or authentication mechanism.

The handler must:

- Validate authenticity before processing.
- Record the provider event identifier.
- Reject or safely ignore duplicate events.
- Persist sufficient information to recover processing failures.
- Return appropriate responses without performing lengthy downstream work synchronously.
- Avoid logging secrets, payment credentials, or unnecessary personal information.

### 10.4 Idempotency

Use provider idempotency keys for external requests where supported.

Maintain internal idempotency independently. A provider's idempotency guarantee does not prevent duplicate internal invoices, allocations, or outbox events.

### 10.5 Payment states

Use a normalized internal lifecycle, for example:

- `pending`
- `processing`
- `succeeded`
- `failed`
- `cancelled`
- `partially_refunded`
- `refunded`

The adapter maps provider-specific statuses into these states.

A delayed or duplicate provider event must not move a terminal payment to an incompatible state without an explicit correction or reconciliation workflow.

The invoice state is derived from confirmed payment allocations and adjustments, not copied directly from the provider's payment state.

## 11. Refunds, disputes, and reversals

Refunds and disputes are separate from invoice corrections.

### 11.1 Refunds

A refund returns previously collected funds.

The platform must record:

- Original payment.
- Refund request and reason.
- Amount and currency.
- Provider reference.
- Refund status.
- Initiating actor or system process.
- Confirmation timestamp.

A refund must not automatically erase the original payment record.

The effect on the invoice balance depends on the commercial and accounting policy. Refunding a payment does not necessarily mean the original invoice was incorrect.

### 11.2 Disputes and chargebacks

Where supported by the provider, record disputes as explicit financial events with provider references, amounts, deadlines, and outcomes.

A dispute must not silently rewrite invoice history or mark a payment as failed if the provider's model distinguishes a dispute from a payment failure.

### 11.3 Reversals

If a previously confirmed payment is reversed, record the reversal and update the derived settlement state through an explicit workflow.

Do not delete the original payment allocation to conceal the reversal.

## 12. Financial calculations

### 12.1 Invoice totals

A basic invoice calculation can be expressed as:

\[
\text{Subtotal} = \sum \text{Line amounts before invoice-level adjustments}
\]

\[
\text{Total} =
\text{Subtotal}
- \text{Discounts}
+ \text{Taxes}
+ \text{Other approved charges}
\]

The exact ordering and tax basis must follow the configured pricing and applicable legal requirements.

Credits applied to the invoice must be represented explicitly so that the original charges, credits, and remaining amount can be reconstructed.

### 12.2 Amount due

The outstanding amount must be derived from issued charges, valid credit allocations, confirmed payment allocations, and other approved settlement adjustments.

A simplified representation is:

\[
\text{Amount due}
=
\text{Invoice total}
- \text{Allocated payments}
- \text{Applied credits}
\]

The implementation must account for refunds, reversals, write-offs, and credit-note effects according to the applicable policy. It must not subtract the same financial event twice.

### 12.3 Currency rules

An invoice must have one currency.

A payment allocation must use the invoice currency unless a documented multi-currency settlement feature exists. Cross-currency settlement requires explicit exchange-rate sourcing, rate timestamps, rounding rules, and accounting treatment.

The initial implementation must reject unsupported currency mismatches rather than silently convert amounts.

### 12.4 Tax

Tax calculation must be implemented behind a dedicated policy or provider interface if the product needs tax support.

The architecture must allow the platform to retain the tax basis, jurisdiction, rate, calculation result, and relevant tax metadata for issued invoices.

Do not hardcode tax rates or assume one country's tax rules apply to all customers. Tax requirements must be confirmed for the markets in which the platform operates.

## 13. Financial ledger boundary

The billing subsystem records commercial obligations and their settlement status. It is not automatically a complete accounting ledger.

If a separate financial ledger is integrated, billing must emit well-defined events such as:

- `invoice.issued`
- `invoice.paid`
- `invoice.credited`
- `payment.succeeded`
- `payment.refunded`
- `payment.reversed`

The ledger integration determines the corresponding accounting entries under its own posting rules.

Events must include stable identifiers, currency, exact amounts, timestamps, and references sufficient for reconciliation.

The billing module must not write directly into another system's internal tables.

## 14. API design

Use versioned REST endpoints documented through OpenAPI.

### 14.1 Customer-facing endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/invoices` | List invoices available to the authenticated billing account. |
| `GET` | `/v1/invoices/{invoiceId}` | Retrieve invoice details. |
| `GET` | `/v1/invoices/{invoiceId}/lines` | Retrieve invoice lines. |
| `GET` | `/v1/invoices/{invoiceId}/document` | Retrieve the rendered invoice document. |
| `POST` | `/v1/invoices/{invoiceId}/payments` | Initiate payment where online collection is supported. |
| `GET` | `/v1/payments/{paymentId}` | Retrieve authorized payment status. |
| `GET` | `/v1/billing-account/credit-balance` | Retrieve available account credit where supported. |

The billing account must be derived from or authorized against the authenticated context. Changing an invoice ID must never grant access to another tenant's financial records.

### 14.2 Administrative endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/v1/admin/invoices/{invoiceId}/credit-notes` | Create an authorized credit note. |
| `POST` | `/v1/admin/invoices/{invoiceId}/void` | Request an authorized void operation where permitted. |
| `POST` | `/v1/admin/payments/{paymentId}/refunds` | Initiate a permitted refund. |
| `GET` | `/v1/admin/billing-operations/{operationId}` | Inspect a billing operation. |
| `POST` | `/v1/admin/billing/reconciliation-runs` | Start a reconciliation run. |

Administrative endpoints require explicit permissions, audit records, reason codes, and appropriate approval controls for high-impact actions.

### 14.3 Idempotency and concurrency

Financial mutation endpoints must support idempotency keys where retries could cause duplicate financial effects.

Use optimistic concurrency or transactional locking for conflicting changes to invoices, credits, payment allocations, and refunds.

Do not expose a general endpoint that permits clients to set invoice totals, payment status, or account credit balances directly.

## 15. Reconciliation

Reconciliation compares internal financial records with the provider's authoritative transaction records.

### 15.1 Payment reconciliation

The reconciliation worker must:

1. Retrieve provider transactions for a defined period or reference set.
2. Match transactions using provider IDs and internal correlation references.
3. Compare amount, currency, status, and timestamps.
4. Identify missing, duplicated, delayed, or inconsistent records.
5. Record discrepancies.
6. Apply only authorized, idempotent corrections.
7. Preserve the reconciliation evidence and final outcome.

### 15.2 Invoice reconciliation

Verify that:

- Invoice line totals match the stored invoice totals.
- Allocated payments do not exceed the valid allocatable amount without an explicit exception policy.
- Applied credits reference valid credit transactions.
- Issued invoice contents remain immutable.
- Billing operations have not generated duplicate invoices.
- Usage-based invoice lines match the designated billable usage sources.

### 15.3 Discrepancy handling

Use explicit discrepancy categories, such as:

- `MISSING_PROVIDER_TRANSACTION`
- `MISSING_INTERNAL_PAYMENT`
- `AMOUNT_MISMATCH`
- `CURRENCY_MISMATCH`
- `STATUS_MISMATCH`
- `DUPLICATE_TRANSACTION`
- `UNALLOCATED_PAYMENT`
- `INVOICE_TOTAL_MISMATCH`

A discrepancy must have an owner or handling policy, a recorded status, and an auditable resolution.

Reconciliation must not silently modify issued invoices or discard provider transactions.

## 16. Security, privacy, and audit

### 16.1 Access control

Enforce least-privilege permissions for:

- Viewing billing records.
- Initiating payment.
- Issuing invoices.
- Issuing credit notes.
- Voiding invoices.
- Initiating refunds.
- Modifying pricing configuration.
- Performing reconciliation.
- Viewing cross-tenant financial data.

Tenant isolation must apply to invoices, lines, payments, credits, and reconciliation details.

### 16.2 Payment data

Prefer hosted payment pages or provider-managed payment components when collecting payment credentials.

Do not store raw card security codes. Avoid storing sensitive payment credentials unless the architecture, provider integration, and applicable compliance requirements explicitly support it.

Store provider tokens or references only when needed, protect them appropriately, and never expose them through ordinary customer-facing APIs.

### 16.3 Audit history

Record at least:

- Invoice draft creation and issuance.
- Invoice voids and credit notes.
- Payment initiation and confirmed outcomes.
- Payment allocations and changes.
- Refunds and reversals.
- Pricing or billing-policy changes.
- Manual financial adjustments.
- Reconciliation runs and discrepancy resolutions.

Include the actor or system process, tenant, object references, timestamp, reason, correlation ID, and relevant before/after values.

Audit records must not be editable through ordinary billing APIs.

## 17. Observability and operations

Recommended metrics:

- Invoices generated, issued, and failed.
- Invoice-generation latency.
- Billing-operation retries and backlog age.
- Payment success and failure rates.
- Provider webhook verification failures.
- Duplicate events safely ignored.
- Unallocated payment count and amount.
- Reconciliation discrepancy count and age.
- Refund and reversal processing failures.
- Credit-note creation volume.
- Invoice calculation validation failures.

Use structured logs and distributed tracing across subscription, metering, billing, payment, and notification workflows.

Avoid exposing payment credentials, sensitive customer details, or raw provider payloads in general logs.

Operational runbooks must cover failed invoice generation, provider outages, webhook backlog recovery, reconciliation discrepancies, and controlled financial corrections.

## 18. Testing strategy

### Unit tests

- Flat recurring charge calculation.
- Per-unit and metered charge calculation.
- Graduated and volume tier boundaries.
- Discounts, allowances, and minimum charges.
- Proration under each supported policy.
- Currency precision and rounding.
- Invoice totals and credit allocation.
- Partial payment and refund calculations.
- Invalid currency and pricing configurations.

### Integration tests

- Concurrent invoice-generation jobs do not create duplicates.
- Issued invoices cannot be modified through normal APIs.
- Duplicate provider events do not duplicate payments or allocations.
- Partial payments produce the correct outstanding balance.
- Credit notes preserve original invoice history.
- Failed billing operations recover safely after retries.
- Provider webhook verification is enforced.
- Reconciliation identifies mismatched records.
- Tenant isolation applies to every billing resource.

### Failure tests

- Provider timeout after an external request may have succeeded.
- Duplicate and out-of-order webhooks.
- Worker failure between invoice creation and issuance.
- Database failure during payment allocation.
- Delayed usage events after invoice issuance.
- Refund failure after initiation.
- Reconciliation interrupted midway through a run.

### End-to-end tests

- Create a subscription and issue its first invoice.
- Generate recurring invoices across a billing-period boundary.
- Apply a plan change with proration.
- Generate an invoice from metered usage.
- Pay an invoice partially and then settle it.
- Issue a credit note against an issued invoice.
- Process a refund and reconcile the provider result.
- Recover a failed billing operation without duplicate financial records.

Use Jest, Supertest, Testcontainers, Vitest, React Testing Library, and Playwright where appropriate.

## 19. Implementation sequence

1. Implement billing accounts and currency configuration.
2. Implement the pricing calculation engine with exact arithmetic.
3. Implement invoice drafts, lines, and immutable issuance.
4. Add recurring billing operations and invoice-generation idempotency.
5. Integrate usage aggregates and one-time charges.
6. Implement payment-provider interfaces and one initial provider adapter.
7. Add payment records, webhook processing, and invoice allocations.
8. Implement credits, credit notes, and authorized adjustments.
9. Add refunds and reversal workflows.
10. Implement provider reconciliation and discrepancy handling.
11. Add tax support only after requirements are established.
12. Integrate the financial ledger where needed.
13. Complete operational monitoring, audit controls, and recovery runbooks.

Keep billing within the modular monolith initially. Use durable PostgreSQL-backed jobs and an outbox rather than introducing distributed infrastructure before it is justified.

## 20. Acceptance criteria

The implementation is ready when:

- Financial arithmetic is exact and follows documented rounding rules.
- Pricing calculations are deterministic and traceable.
- Published price versions and issued invoices are immutable.
- Corrections use explicit adjustment records.
- Invoice generation is idempotent under retries and concurrent workers.
- Payment state is confirmed through trusted provider evidence.
- Duplicate or out-of-order provider events cannot cause duplicate financial effects.
- Partial payments, credits, refunds, and reversals are represented explicitly.
- Invoice balances are derived consistently from financial records.
- Tenant isolation applies to all billing data and administrative operations.
- Provider reconciliation detects and records discrepancies.
- Billing failures can be recovered without losing or duplicating financial history.
- Usage charges originate from the designated metering records.
- Subscription lifecycle changes remain the responsibility of the subscription module.
- Automated tests cover financial boundaries, retries, concurrency, and failure recovery.

## 21. Relationship to the next document

The next document, `docs/architecture/api-specification.md`, will consolidate the public and internal REST API contracts for the Tally, including resource schemas, authentication assumptions, idempotency, pagination, errors, and versioning.

The architectural boundary is deliberate:

**Subscriptions define the agreement. Entitlements define granted capabilities. Quotas enforce consumption. Usage metering records activity. Billing creates auditable financial obligations and tracks settlement.**