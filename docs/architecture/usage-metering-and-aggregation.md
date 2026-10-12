# Tally — Usage Metering and Aggregation

## 1. Purpose

This document defines how the platform receives, validates, deduplicates, stores, aggregates, and reports customer usage.

Usage metering is a foundational subsystem. Subscription entitlements and invoices depend on its correctness. The system must therefore preserve reliable event ingestion, deterministic aggregation, traceability, and explicit correction procedures.

The metering subsystem must answer four questions:

1. What activity occurred?
2. Which tenant, customer, subscription, and metric does it belong to?
3. How much usage must be attributed to a defined period?
4. Can the reported total be reproduced from its underlying events?

## 2. Design Principles

### 2.1 Events are the source of truth

Accepted usage events are the authoritative record of reported consumption. Aggregates are derived data used for efficient querying, quota evaluation, and billing.

An aggregate must never become the only surviving evidence of billable usage unless an explicit archival and audit policy preserves the underlying evidence elsewhere.

### 2.2 Delivery is at least once

Clients, queues, and workers may retry requests. The platform must assume that an event can be delivered multiple times.

Deduplication must prevent repeated delivery from increasing usage more than once within the configured idempotency scope.

The platform does not promise exactly-once delivery across external systems.

### 2.3 Event time differs from receipt time

The time an activity occurred may differ from the time the platform received it.

Both timestamps must be stored:

- `occurred_at`: When the activity happened.
- `received_at`: When the platform accepted or recorded the event.

Billing and reporting rules must explicitly determine which timestamp governs period attribution.

### 2.4 Measurement is separate from pricing

Metering records quantities. The billing engine applies the applicable pricing rules to those quantities.

For example, metering may record 12,000 API requests. Pricing determines whether those requests are included in a plan allowance, charged per unit, or priced through tiers.

The metering subsystem must not embed assumptions about a particular plan's prices.

### 2.5 Every result must be explainable

For any reported usage total, the platform must be able to identify the metric definition, aggregation method, period boundaries, contributing events, and any corrections applied.

## 3. Core Concepts

### 3.1 Usage metric

A metric defines what is measured and how its events are interpreted.

Examples:

- API requests.
- Compute seconds.
- Stored gigabyte-hours.
- Messages delivered.
- Active seats.
- Documents processed.

A metric definition must specify:

- Stable identifier and code.
- Unit of measurement.
- Supported quantity precision.
- Aggregation method.
- Event-time policy.
- Attribution rules.
- Whether negative corrections are supported.
- Late-event acceptance policy.
- Applicable retention policy.

Changing a metric's unit or aggregation semantics must not silently reinterpret historical events. Create a new metric version or perform a documented migration.

### 3.2 Usage event

A usage event represents a discrete report of measurable activity.

Required logical fields:

| Field | Purpose |
|---|---|
| `event_id` | Platform-generated unique identifier |
| `external_event_id` | Producer-supplied idempotency identifier |
| `tenant_id` | Tenant ownership |
| `customer_account_id` | Customer attribution |
| `subscription_id` | Applicable subscription, when known |
| `metric_id` | Metric being measured |
| `quantity` | Reported amount |
| `occurred_at` | Event time |
| `received_at` | Acceptance time |
| `source` | Producing integration or application |
| `dimensions` | Validated attribution metadata |
| `status` | Acceptance or correction state |

The API must validate the relationships between tenant, customer, subscription, and metric. Merely providing valid individual identifiers does not establish that the records belong together.

### 3.3 Usage aggregate

An aggregate summarizes usage across a defined interval and attribution scope.

Logical fields include:

- Tenant.
- Customer account.
- Subscription.
- Metric.
- Period start and end.
- Aggregation method.
- Aggregated value.
- Event count.
- Revision or calculation version.
- Calculation timestamp.

Aggregation periods use half-open intervals: the start is inclusive and the end is exclusive.

For example, an event occurring exactly at midnight belongs to the period beginning at that midnight, not the period that just ended.

## 4. Supported Aggregation Methods

The first release must support a small, explicit set of aggregation methods.

### 4.1 Sum

Adds all eligible event quantities.

\[
U_{\text{sum}}=\sum_{i=1}^{n}q_i
\]

Suitable for requests, compute time, processed records, and other additive quantities.

### 4.2 Count

Counts eligible events, regardless of their reported quantity.

\[
U_{\text{count}}=n
\]

Suitable when each accepted event represents one occurrence. The system must define whether corrected, cancelled, or otherwise excluded events contribute to the count.

### 4.3 Maximum

Returns the highest eligible observed value.

\[
U_{\text{max}}=\max(q_1,\ldots,q_n)
\]

Suitable for maximum observed concurrency or peak resource measurements, provided the event model represents comparable observations.

### 4.4 Last value

Returns the value of the latest eligible observation according to a deterministic ordering rule.

The ordering must use event time and a stable tie-breaker, such as the event identifier. Receipt time must not silently replace event time as the ordering criterion.

### 4.5 Future aggregation methods

A later release may add:

- Distinct-user or distinct-resource counts.
- Time-weighted averages.
- Percentile calculations.
- Histograms.
- Rate-based measurements.
- Windowed maximum or minimum values.

Distinct counting and percentile calculations may require specialized storage or approximate algorithms. They must not be represented as simple sums unless that accurately describes the metric.

## 5. Event Ingestion Architecture

The ingestion flow is:

1. Authenticate the producer.
2. Resolve the tenant and integration identity.
3. Validate the request structure and size.
4. Validate the metric, customer, subscription, and quantity.
5. Check event-time policy.
6. Enforce the idempotency constraint.
7. Persist the accepted event.
8. Persist any required durable processing work.
9. Return the acceptance outcome.
10. Aggregate the event asynchronously.

### 5.1 Synchronous API responsibilities

The ingestion endpoint must perform validation and durable persistence without waiting for all downstream aggregates to finish.

A successful acceptance response means the platform has durably recorded the event or an equivalent recoverable ingestion record.

It does not mean that every usage dashboard or invoice calculation has already incorporated the event.

### 5.2 Transactional persistence

When usage persistence and job scheduling share PostgreSQL, insert the event and the required processing-job or outbox record in the same transaction.

This prevents a failure scenario in which the event is stored but its required processing notification is lost.

Workers must claim durable jobs safely and tolerate repeated execution.

### 5.3 Batch ingestion

Batch ingestion can reduce network overhead for high-volume producers.

A batch must define whether acceptance is atomic or per-event.

Recommended initial behavior is **per-event outcomes**:

- Each event is independently validated.
- Valid events are accepted.
- Invalid events receive explicit rejection results.
- Duplicate events are identified.
- Retrying a batch does not duplicate previously accepted events.

A response must provide enough information to correlate each result with the producer's event identifier.

Limit batch size and request payload size to prevent resource exhaustion.

## 6. Idempotency and Deduplication

### 6.1 Idempotency key

Every producer must supply a stable event identifier that remains unchanged across retries.

The deduplication scope must be explicitly defined. A reasonable initial choice is:

`tenant_id + source + external_event_id`

This works when event identifiers are unique within each producer source. If producers can reuse identifiers across independent streams, include the appropriate stream or integration identifier.

The exact scope must be fixed before the database uniqueness constraint and public API contract are finalized.

### 6.2 Duplicate behavior

When an existing event identifier is received again:

- Do not create another accepted usage event.
- Return a response identifying the request as a duplicate or previously accepted event.
- Do not silently replace the original quantity or timestamp.
- If the duplicate identifier carries a different payload, report an idempotency conflict rather than accepting the altered event as a new event.

A payload hash may be stored to compare retries without retaining unnecessary copies of the full request.

### 6.3 Database enforcement

Deduplication must rely on a database uniqueness constraint or a dedicated idempotency registry, not a prior application-level lookup alone.

Two concurrent requests can both pass an application lookup before either inserts a record.

### 6.4 Retention of idempotency records

Idempotency records must remain available for at least the documented producer retry window.

For billable events, deduplication records must not be deleted while the corresponding event could still be resubmitted and counted again. If raw events are archived, their idempotency protection must remain effective across archival and partition boundaries.

## 7. Event-Time Policy and Late Events

### 7.1 Event-time validation

Each metric or ingestion policy must define:

- Maximum accepted age.
- Maximum permitted future timestamp offset.
- Whether delayed events are accepted.
- Whether closed billing periods can receive late events.
- How rejected or quarantined events are reviewed.

These values must be configurable by deployment or metric policy rather than scattered across application code.

The server's receipt timestamp must be assigned by the platform.

### 7.2 Late-arriving events

A late event is received after the normal processing window for its event time.

The system must distinguish between:

- **Late but eligible:** Accepted and included through re-aggregation.
- **Late and requiring review:** Stored in a controlled quarantine or review workflow.
- **Rejected:** Not accepted as billable usage because it violates the documented event-time policy.

Do not silently discard late events.

### 7.3 Closed billing periods

The platform must distinguish usage reporting from finalized billing.

A late event may be accepted for historical usage reporting without automatically changing an issued invoice.

If a late event affects an already finalized billing obligation, the billing domain must apply the documented correction policy, such as an adjustment or a charge on a subsequent invoice.

This preserves the integrity of issued financial records.

## 8. Aggregation Processing

### 8.1 Processing model

Aggregation runs asynchronously in durable, retryable jobs.

A worker:

1. Claims a processing job.
2. Loads the accepted events or the affected time range.
3. Resolves the metric definition applicable to those events.
4. Calculates the aggregate.
5. Persists the result using an idempotent update or revision strategy.
6. Records the processing checkpoint.
7. Marks the job complete.

Failures must leave enough durable state for a retry.

### 8.2 Idempotent aggregation

Repeated processing of the same event must not increment the aggregate repeatedly.

Two supported strategies are:

**Recompute affected windows:** Recalculate the aggregate from the eligible source events for a bounded interval. This is easier to reason about and is recommended for the first implementation.

**Incremental aggregation:** Apply event-level contributions using durable processed-event tracking and transactional updates. This may be more efficient at scale but requires more complex correction and recovery logic.

Begin with bounded recomputation for correctness. Introduce incremental processing only when measurements demonstrate that recomputation is too expensive.

### 8.3 Aggregate identity

The aggregate's unique identity must include:

- Tenant.
- Customer account.
- Subscription.
- Metric.
- Period start.
- Period end.
- Any dimension that changes the aggregation scope.

The implementation must normalize nullable scope fields or use appropriate database constraints so that logically identical aggregates cannot be inserted twice.

### 8.4 Revision strategy

When new events or corrections change a previously computed aggregate, the system must make the change traceable.

A revision may contain:

- Aggregate identity.
- Previous revision.
- New value.
- Calculation timestamp.
- Reason for recalculation.
- Processing job or correction reference.

Whether every revision is stored as a full snapshot or recorded through a separate revision history is an implementation choice. The platform must retain enough information to explain material historical changes.

## 9. Aggregation Windows and Dimensions

### 9.1 Window types

The first release must support:

- Fixed billing-period windows.
- Calendar-day windows.
- Calendar-month windows.
- Configurable fixed-duration windows where required.

Each window must define its timezone and boundary rules.

For calendar-based windows, store the resolved UTC boundaries as well as the relevant timezone configuration when that information is needed to reproduce the calculation.

### 9.2 Dimensions

Dimensions support controlled breakdowns such as region, resource type, or service category.

Requirements:

- Validate dimension names and types.
- Limit the number of dimensions per event.
- Limit key and value lengths.
- Avoid accepting arbitrary sensitive data.
- Do not create database indexes for every possible dimension.
- Define which dimensions affect billing and which are reporting-only.

A dimension must not change pricing merely because it appears in an event. Any price-affecting dimension must be explicitly declared in the applicable pricing configuration.

### 9.3 Cardinality control

Unbounded dimension values can create large indexes, expensive grouping operations, and excessive storage growth.

The platform must support metric-level dimension allowlists, cardinality limits where appropriate, and monitoring of high-cardinality sources.

## 10. Usage Corrections and Reversals

Accepted events must be treated as immutable source records.

When an event is wrong, use an explicit correction workflow rather than silently changing the original event.

Depending on the metric semantics, correction mechanisms may include:

- A compensating event.
- A replacement event linked to the original.
- A controlled correction record that changes aggregation eligibility.

The correction must identify the original event, the reason, the actor or source, and the time of correction.

For additive metrics, a compensating event may use a negative quantity if the metric explicitly permits it. For count, maximum, and last-value metrics, correction semantics require special care; subtracting a quantity is not a universal correction method.

Correction rules must specify whether they affect:

- Current usage totals.
- Historical reporting.
- Quota consumption.
- Draft billing calculations.
- Already issued invoices.

Issued invoices are corrected through the billing and invoicing workflows, not by silently rewriting financial records.

## 11. Usage Query API

The usage API must support querying by:

- Metric.
- Customer account.
- Subscription.
- Time range.
- Optional permitted dimensions.
- Aggregation method.

A logical endpoint design may include:

- `POST /v1/usage/events`
- `POST /v1/usage/events:batch`
- `GET /v1/usage/events/{eventId}`
- `GET /v1/usage/summary`
- `GET /v1/usage/metrics`
- `GET /v1/usage/processing-status`

Exact REST naming and request formats will be finalized in the API specification.

### 11.1 Query behavior

Usage queries must:

- Require authenticated and authorized tenant context.
- Validate time-range boundaries.
- Apply pagination to raw event queries.
- Limit the maximum query interval where necessary.
- Distinguish raw events from computed aggregates.
- Return the metric unit and aggregation method.
- Indicate whether the result is current or still subject to processing lag.

### 11.2 Processing freshness

The API must expose an appropriate processing watermark, last-computed timestamp, or freshness indicator.

A consumer must not assume that an accepted event has already appeared in every aggregate.

The freshness indicator must describe the actual processing guarantee, not imply that all events before a timestamp are complete if late arrivals remain possible.

## 12. Billing Integration Contract

The metering module supplies usage evidence and totals to the billing module.

A billing request must specify:

- Tenant.
- Customer account.
- Subscription.
- Metric.
- Billing-period start and end.
- Applicable aggregation semantics.
- Pricing version or reference.
- Usage snapshot or calculation-input reference.

The billing engine must not query an unspecified “current usage total” and assume it represents a stable historical billing result.

For each billing calculation, the platform must capture a stable usage snapshot or equivalent reproducible input set. The snapshot must define how events arriving during calculation are handled.

A billing calculation must be repeatable against the same snapshot and pricing version.

## 13. Quota Integration Contract

Quota enforcement consumes usage information but has different consistency requirements from reporting.

For eventual quotas, the system may use periodically refreshed aggregates and accept documented temporary overshoot.

For strict quotas, the system must use atomic reservations or equivalent concurrency-safe state. A reporting aggregate alone is insufficient because two simultaneous operations can both observe the same remaining capacity.

When a reservation is committed, the platform must define how it relates to the eventual usage event so the same consumption is not counted twice.

A reservation is not itself a billable usage event unless the applicable product contract explicitly defines it as such.

## 14. Security and Abuse Prevention

The ingestion subsystem must defend against:

- Cross-tenant event injection.
- Replayed events.
- Forged customer or subscription references.
- Excessive batch sizes.
- Invalid or extreme quantities.
- Future-dated or stale events.
- High-cardinality dimension abuse.
- Excessive request rates.
- Malformed or oversized metadata.
- Attempts to alter accepted events using duplicate identifiers.

Integration credentials must be scoped to the allowed tenants, metrics, and operations.

The platform must not trust a client-supplied price or charge amount as authoritative usage-billing input.

## 15. Observability

Track at least the following:

### Ingestion

- Events received and accepted.
- Rejected events by reason.
- Duplicate events.
- Idempotency conflicts.
- Batch sizes.
- Ingestion latency.
- Request throttling.

### Aggregation

- Processing lag.
- Jobs completed and failed.
- Retry counts.
- Recalculation duration.
- Aggregate revision counts.
- Late-event volume.
- Difference between source-event totals and aggregate totals where a reliable comparison is available.

### Billing integrity

- Events excluded by billing-window policy.
- Usage snapshot creation failures.
- Calculations blocked by incomplete usage processing.
- Late events affecting previously closed periods.
- Reconciliation discrepancies.

Use structured logs and correlation identifiers to connect ingestion requests, processing jobs, aggregate revisions, and billing calculations.

## 16. Testing Strategy

### Unit tests

- Every aggregation method.
- Event-time window boundaries.
- Metric quantity validation.
- Dimension validation.
- Late-event classification.
- Correction semantics.
- Deterministic tie-breaking for last-value aggregation.

### Integration tests

- Concurrent duplicate ingestion.
- Batch partial-success behavior.
- Database uniqueness enforcement.
- Transactional persistence of events and processing jobs.
- Retry-safe aggregation.
- Recalculation after late events.
- Tenant isolation.
- Usage snapshot reproducibility.
- Interaction between reservations and reported usage.

### Property and invariant tests

- Reprocessing an unchanged event set produces the same aggregate.
- Duplicate delivery does not change the aggregate.
- Half-open time windows do not count an event in two adjacent periods.
- Sum aggregation equals the total of all eligible quantities.
- Corrections change results only according to the documented metric policy.
- A billing calculation using the same stable inputs produces the same monetary result.

Use PostgreSQL integration tests through Testcontainers for concurrency and uniqueness behavior.

## 17. Initial Implementation Sequence

1. Define immutable metric definitions and validation rules.
2. Implement authenticated single-event ingestion.
3. Add database-enforced idempotency.
4. Implement batch ingestion with per-event outcomes.
5. Persist durable aggregation jobs transactionally.
6. Implement bounded-window recomputation.
7. Add aggregate queries and freshness indicators.
8. Define late-event and correction policies.
9. Integrate usage snapshots with billing calculations.
10. Integrate usage state with quota reservation workflows.
11. Add operational metrics, retention controls, and load tests.

Do not introduce distributed streaming infrastructure before actual volume, throughput, and latency requirements justify it. PostgreSQL-backed ingestion and workers are sufficient for the initial modular monolith if the workload and retention policy remain within tested limits.

## 18. Acceptance Criteria

The subsystem is ready for initial production use when:

- Retrying an accepted event does not increase usage.
- Reusing an event identifier with conflicting content produces an explicit conflict.
- Events are durably recorded before successful acceptance is returned.
- Aggregation jobs survive worker restarts.
- Reprocessing an unchanged event set produces the same result.
- Period boundaries are deterministic and tested.
- Late events follow a documented policy.
- Corrections preserve source history and explain aggregate changes.
- Usage summaries identify their metric, unit, period, and freshness.
- Billing calculations can reference stable usage inputs.
- Strict quotas cannot be exceeded through concurrent reservations within the documented enforcement scope.
- Tenant isolation is tested at both application and database levels.
- Retention and deduplication policies do not permit archived events to be counted again.

## 19. Next Document

The next document is `docs/architecture/subscriptions-and-entitlements.md`. It will define subscription lifecycle transitions, plan changes, entitlement resolution, feature access, included allowances, trials, cancellation, and effective subscription permissions.