# Tally — Architecture Overview

## 1. Purpose

The Tally provides reusable infrastructure for measuring customer usage, managing subscriptions and entitlements, enforcing quotas, calculating charges, and producing auditable invoices.

It is designed to support multiple SaaS products without requiring each product to implement its own billing infrastructure.

The platform must make three concerns independently reliable:

1. **Usage metering:** What did a customer consume?
2. **Entitlement enforcement:** What is the customer allowed to access or consume?
3. **Billing:** What must the customer be charged?

These concerns interact, but they must not be treated as the same operation.

## 2. Architectural Goals

- Support multiple organizations and SaaS tenants.
- Define reusable products, plans, pricing models, and billing intervals.
- Ingest usage events reliably, with idempotency and deduplication.
- Aggregate usage across configurable time windows.
- Enforce quotas and feature entitlements.
- Manage subscriptions, plan changes, and subscription lifecycle events.
- Calculate charges deterministically from versioned pricing rules.
- Generate invoices with reproducible line-item calculations.
- Maintain audit trails for financially significant operations.
- Expose stable APIs and integration mechanisms to external applications.
- Support horizontal scaling of ingestion and background processing.
- Allow payment providers to be integrated without coupling billing calculations to a particular provider.

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | NestJS, TypeScript |
| Database | PostgreSQL |
| API | REST with OpenAPI |
| Background processing | Durable database-backed jobs initially |
| Testing | Jest, Supertest, Testcontainers, Vitest, React Testing Library, Playwright |
| Packaging | Docker |
| Local development | Docker Compose |
| Deployment | Container-based environments |

The initial implementation must use a modular monolith rather than independently deployed microservices. Modules must communicate through explicit interfaces and application services.

Background workers may run as separate processes from the API while sharing the same application code and database.

## 4. Architectural Principles

### 4.1 Separate measurement, access, and money

Usage records represent observed consumption. Entitlements represent permission or allowance. Invoices represent financial obligations.

A usage event must not directly mutate an invoice or grant an entitlement. Instead, each concern processes authoritative records through its own application workflows.

### 4.2 Preserve historical correctness

Pricing, plans, subscriptions, and invoices change over time. Historical invoices must remain explainable even after a customer changes plans or an administrator edits a product's current pricing.

The platform must preserve the applicable pricing version, billing period, calculation inputs, and generated invoice line items.

### 4.3 Design for retries

Networks fail, clients retry, workers restart, and messages may be delivered more than once.

All externally submitted usage events and retryable background jobs must have explicit idempotency or deduplication rules. The platform must not rely on exactly-once delivery.

### 4.4 Make financial operations auditable

Financial calculations must be deterministic and traceable. Issued invoices must not be silently rewritten when their source configuration changes.

Corrections must use explicit adjustment, credit, void, or replacement workflows, subject to the invoice's lifecycle state.

### 4.5 Keep provider integrations replaceable

The core billing domain must not depend directly on a specific payment gateway. Payment collection, refunds, and payment-status synchronization belong behind provider-specific adapters.

## 5. High-Level Architecture

The platform consists of the following logical layers.

### 5.1 Management interface

The web application allows authorized users to:

- Create products and pricing plans.
- Configure usage metrics and aggregation rules.
- Manage subscriptions and customer accounts.
- Inspect usage records and aggregated consumption.
- Configure entitlements and quotas.
- Review invoices, adjustments, and payment status.
- View audit records and operational health.

Administrative capabilities must be separated from tenant-level customer capabilities.

### 5.2 API layer

The API layer provides authenticated endpoints for:

- Tenant and customer management.
- Product, plan, and price configuration.
- Subscription lifecycle management.
- Usage event ingestion and usage queries.
- Entitlement and quota checks.
- Invoice retrieval and billing operations.
- Payment-provider callbacks.
- Administrative and audit operations.

The API layer performs request validation, authentication, authorization, tenant-context resolution, rate limiting where appropriate, and request-level idempotency checks.

### 5.3 Domain modules

The backend is divided into cohesive modules:

- **Tenancy:** Organizations, tenant context, membership, and isolation.
- **Catalog:** Products, plans, prices, and pricing versions.
- **Usage Metering:** Metric definitions, usage events, deduplication, and aggregation.
- **Entitlements:** Feature access, allowances, and effective subscription permissions.
- **Subscriptions:** Subscription lifecycle, billing intervals, and plan changes.
- **Quotas:** Usage limits, consumption checks, and enforcement policies.
- **Billing:** Rating, charge calculation, billing periods, and invoice generation.
- **Payments:** Provider adapters, payment attempts, payment records, and reconciliation.
- **Audit:** Append-oriented records of significant administrative and financial actions.
- **Notifications:** Delivery of invoice, subscription, and payment-related notifications.
- **Operations:** Background jobs, retries, job status, and operational diagnostics.

Each module owns its domain rules and exposes explicit interfaces to other modules. Modules must not modify one another's tables directly without an approved ownership boundary.

### 5.4 Persistence layer

PostgreSQL is the initial source of truth for transactional domain data.

It stores:

- Tenant and customer records.
- Catalog and pricing versions.
- Subscriptions and entitlement assignments.
- Usage events and aggregation checkpoints.
- Quota policies and enforcement state.
- Billing periods, invoice calculations, and invoices.
- Payment attempts and provider references.
- Audit records and background-job state.

Use database constraints and transactions to enforce invariants that cannot safely depend on application checks alone.

### 5.5 Background processing

Background workers handle operations that must not depend on a single synchronous API request:

- Usage aggregation.
- Subscription lifecycle transitions.
- Billing-period processing.
- Invoice generation.
- Payment-status reconciliation.
- Webhook and notification delivery.
- Retryable integration tasks.

Jobs must have durable state, retry policies, idempotent processing, and observable failure states. A job must not disappear merely because a worker restarts.

## 6. Core Data Flow

### 6.1 Usage ingestion

1. A customer application authenticates with the platform.
2. It submits a usage event with a tenant context, metric identifier, event identifier, quantity, and occurrence time.
3. The platform validates the metric, tenant, event shape, and ingestion permissions.
4. An idempotency constraint prevents the same event from being counted twice within its defined scope.
5. The accepted event is persisted.
6. An aggregation worker processes accepted events into usage summaries.
7. Usage queries and billing calculations read the appropriate authoritative records.

The API must distinguish accepted, rejected, and duplicate events. A duplicate request must not create additional billable usage.

### 6.2 Entitlement and quota checks

1. An application requests an entitlement or consumption check.
2. The platform resolves the tenant and relevant subscription.
3. It calculates the effective entitlement from the applicable plan, subscription state, and permitted overrides.
4. If a quota applies, it evaluates consumption using the metric's defined accounting rules.
5. It returns an explicit decision and relevant limit information.

The system must document whether each quota uses a strict, transactional limit or a near-real-time limit. These have different concurrency and performance characteristics.

### 6.3 Billing and invoicing

1. The billing scheduler identifies subscriptions requiring billing-period processing.
2. The billing engine selects the applicable subscription, pricing version, billing interval, and usage window.
3. It obtains the eligible usage totals and applies the pricing rules.
4. It calculates recurring fees, usage charges, discounts, taxes where configured, and adjustments.
5. It records a reproducible calculation result.
6. It creates an invoice with stable line items and currency-specific rounding rules.
7. The invoice is finalized according to the configured invoice lifecycle.
8. If payment collection is enabled, the payment module initiates collection through a provider adapter.
9. Provider callbacks and reconciliation update payment records without silently changing invoice calculations.

Billing-period processing must be safe to retry. A retry must not create duplicate invoices for the same subscription and billing period.

## 7. Tenant Isolation and Identity

Every tenant-owned resource must have an explicit ownership boundary.

Tenant context must be resolved from authenticated credentials or a validated integration identity, not trusted solely because a client supplied a tenant identifier in a request body.

The platform must enforce:

- Tenant-scoped queries and mutations.
- Authorization checks for tenant membership and role.
- Unique constraints scoped to the appropriate tenant.
- Tenant-aware background jobs.
- Tenant ownership checks for invoices, subscriptions, usage events, and payment records.
- Isolation tests that attempt cross-tenant reads and writes.

Platform administrators may have broader access, but privileged operations must use explicit permissions and produce audit records.

## 8. Usage and Pricing Model

Usage metrics must define what is measured and how it is interpreted. A metric may represent requests, compute time, stored data, messages, seats, or another measurable quantity.

Each metric must define:

- A stable identifier.
- Its unit of measurement.
- Whether fractional quantities are allowed.
- Its aggregation method.
- Its event-time and billing-window semantics.
- Its duplicate-event policy.
- Whether late-arriving events are accepted and how corrections are handled.

Pricing models may include:

- Flat recurring subscription fees.
- Per-unit usage charges.
- Tiered pricing.
- Volume-based pricing.
- Included usage allowances.
- Overage charges.
- One-time charges.
- Configurable discounts.

Only explicitly supported pricing models must be enabled. Each calculation must record the pricing version and inputs used, rather than depending on mutable current catalog configuration.

## 9. Invoice and Payment Boundaries

The initial platform owns invoice calculation, invoice records, line items, balances, and billing-related audit history.

Actual payment collection is an integration concern. Payment providers may authorize or collect payments, issue refunds, and report transaction outcomes. Provider-specific identifiers and statuses must be mapped into a normalized internal payment model.

The platform must not treat an invoice as paid merely because a payment request was submitted. A confirmed provider result or a verified reconciliation process must establish the payment outcome.

The design must allow invoice-only deployments where payment collection is handled externally.

## 10. Reliability and Consistency

The system must explicitly define consistency guarantees for each operation.

- **Usage ingestion:** Durable acceptance before reporting success.
- **Deduplication:** Database-enforced uniqueness within a documented scope.
- **Aggregation:** Retryable processing with checkpoints or processed-event tracking.
- **Entitlement resolution:** Consistent effective permissions for the request's evaluation point.
- **Quota enforcement:** A documented concurrency model; strict limits require atomic reservation or equivalent transactional enforcement.
- **Billing:** Deterministic calculations against stable input snapshots.
- **Invoice creation:** Unique billing-period identity and transactional creation.
- **Payments:** Idempotent provider requests where supported, verified callbacks, and reconciliation.
- **Notifications:** Retryable delivery that cannot duplicate financial state transitions.

Usage events, aggregates, invoice calculations, and finalized invoices must remain distinguishable. Corrections must preserve enough history to explain how reported totals and charges changed.

## 11. Security

Security requirements include:

- Strong authentication for administrative and integration access.
- Role-based authorization with tenant-scoped permissions.
- Secure API key storage, including one-way hashing where keys only need verification.
- Credential rotation and revocation.
- Rate limiting and request-size limits for ingestion endpoints.
- Validation and authentication of payment-provider callbacks.
- Protection against replayed callbacks and duplicate requests.
- Encryption in transit and secure handling of secrets.
- Audit records for pricing changes, subscription changes, invoice actions, and privileged access.
- Redaction of secrets and sensitive payment information from logs.
- Database backups and tested recovery procedures.

Payment card details must be handled by a compliant external payment provider rather than stored directly by this platform unless a separate, justified compliance architecture is approved.

## 12. Observability

The platform must expose structured logs, metrics, and distributed trace context where appropriate.

Operational metrics must include:

- Usage ingestion volume and rejection rate.
- Duplicate-event rate.
- Ingestion latency.
- Aggregation lag and failed jobs.
- Quota-check latency and rejection counts.
- Billing runs started, completed, and failed.
- Invoice-generation failures and duplicate-prevention conflicts.
- Payment attempts and reconciliation discrepancies.
- Background-job retries and dead-lettered or permanently failed work.
- Database connection utilization and query latency.

Logs and metrics must not leak API keys, credentials, or unnecessary customer data.

## 13. Initial Scope

The first production-capable version must include:

1. Tenant and customer management.
2. Product, plan, metric, and versioned price configuration.
3. Subscription lifecycle management.
4. Idempotent usage-event ingestion.
5. Usage aggregation and reporting.
6. Entitlement checks and basic quota enforcement.
7. Recurring and usage-based billing.
8. Invoice generation and explicit invoice lifecycle states.
9. A normalized payment-provider integration boundary.
10. Audit records, background-job retries, monitoring, and backups.
11. API documentation and automated integration tests.
12. An administrative web interface.

## 14. Non-Goals for the Initial Version

The initial version will not attempt to provide:

- A full accounting general ledger.
- Payroll or tax filing.
- Direct storage of payment-card data.
- An unrestricted custom pricing-programming language.
- Globally linearizable quotas across geographically distributed regions.
- A microservices deployment for every domain module.
- Guaranteed exactly-once delivery across external systems.
- Unbounded event retention without an explicit data-retention policy.
- Automatic alteration of finalized invoices when catalog pricing changes.

These capabilities may be considered later if concrete requirements justify them.

## 15. Architectural Acceptance Criteria

The architecture is acceptable when:

- A tenant cannot read or modify another tenant's protected resources.
- Repeated delivery of the same usage event does not increase billable usage.
- Usage totals can be traced back to accepted events and aggregation rules.
- Entitlement decisions are explainable from the applicable subscription and configuration.
- Concurrent quota checks follow the documented enforcement guarantee.
- A billing-period retry cannot create a second invoice for the same billing obligation.
- Historical invoice calculations remain reproducible after catalog changes.
- Payment failures and delayed provider callbacks do not corrupt invoice records.
- Background work survives process restarts and exposes permanent failures.
- Critical domain rules can be tested without running the frontend.
- The API contract is documented and validated by automated tests.

## 16. Next Document

The next document is `docs/architecture/domain-model.md`. It will define the entities, relationships, ownership boundaries, lifecycle states, and invariants that guide the database design and module implementation.