# tally

Metering-to-invoice infrastructure for SaaS: ingest usage events idempotently, enforce entitlements and quotas, calculate charges from versioned pricing, and produce auditable invoices — with payment providers pluggable behind adapters.

**Status:** Early — architecture and domain docs approved, no implementation yet.
**Stack:** NestJS + TypeScript, React + TypeScript + Vite, PostgreSQL, Docker Compose.
**Architecture:** Modular monolith. PostgreSQL is the source of truth. Durable database-backed jobs first; no message broker until a concrete need emerges.

## Why

Every SaaS product eventually rebuilds the same billing stack: usage ingestion with deduplication, quota checks, plan lifecycles, pricing math, invoices. Done badly, retries double-charge customers, plan edits rewrite history, and payment-provider coupling leaks into financial calculations.

tally separates the three concerns that must not be the same operation: measurement (usage metering), access (entitlements and quotas), and money (billing and invoicing). Pricing, subscriptions, and invoices are versioned so historical invoices stay explainable after the catalog changes.

## What it covers

- Tenancy: organizations, tenant context, membership, isolation enforced per query and test
- Catalog: products, plans, prices, immutable pricing versions
- Usage metering: metric definitions, idempotent event ingestion, deduplication, aggregation windows
- Entitlements and quotas: feature access, allowances, documented concurrency model per quota
- Subscriptions: lifecycle, billing intervals, plan changes
- Billing: deterministic rating, billing periods, reproducible invoice line items, adjustment/void/credit workflows
- Payments: normalized internal model, replaceable provider adapters, verified callbacks, reconciliation
- Platform: REST API with OpenAPI contract, audit records, durable background jobs with retries, administrative web interface

Out of scope for v1: general ledger, payroll/tax filing, card data storage, custom pricing DSL, globally linearizable quotas, exactly-once delivery guarantees, microservices per module.

## Docs

- `docs/architecture/architecture-overview.md` — purpose, stack, modules, core flows, acceptance criteria
- `docs/architecture/domain-model.md` — entities, relationships, lifecycle states, invariants
- `docs/architecture/usage-metering-and-aggregation.md` — metrics, ingestion, deduplication, aggregation
- `docs/architecture/subscriptions-and-entitlements.md` — subscription lifecycle, plans, entitlement resolution
- `docs/architecture/quotas-and-enforcement.md` — quota models, concurrency, enforcement policies
- `docs/architecture/billing-and-invoicing.md` — rating, billing periods, invoices, adjustments
- `docs/architecture/api-specification.md` — REST contract, errors, idempotency, versioning
- `docs/architecture/database-design.md` — schema, constraints, transaction boundaries
- `docs/architecture/security-and-tenant-isolation.md` — auth, RBAC, secrets, callback validation
- `docs/architecture/observability-and-operations.md` — logs, metrics, alerts, recovery
- `docs/architecture/deployment-and-environments.md` — environments, config, release process
- `docs/architecture/testing-strategy.md` — unit through financial-integrity testing
- `docs/architecture/implementation-roadmap.md` — phased delivery plan

## License

MIT — see `LICENSE`.
