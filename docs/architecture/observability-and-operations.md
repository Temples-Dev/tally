# Observability and Operations

## 1. Purpose

This document defines how the Tally is monitored, operated, diagnosed, and recovered in production.

The platform handles usage records, subscriptions, entitlements, quotas, invoices, and payment events. Operational visibility must therefore cover both infrastructure health and commercial correctness.

The objectives are to:

- Detect failures before they significantly affect customers.
- Diagnose problems across API requests, database transactions, and background jobs.
- Detect missing, delayed, duplicated, or incorrectly processed usage.
- Identify billing and payment inconsistencies.
- Support safe deployments, recovery, and incident response.
- Establish measurable service objectives without introducing unnecessary infrastructure complexity.

## 2. Operational Architecture

The initial deployment consists of:

- **Frontend:** React, TypeScript, and Vite.
- **API:** NestJS REST API.
- **Worker:** Separate process for asynchronous jobs.
- **Database:** PostgreSQL as the authoritative persistent store.
- **Job persistence:** PostgreSQL-backed durable jobs and transactional outbox records where appropriate.
- **External integrations:** IAM, payment providers, and other configured services.
- **Observability:** Structured logs, metrics, traces where supported, and health endpoints.

The API and worker may run as separate containers while sharing the same codebase and domain modules.

PostgreSQL remains the system of record. Background processing must not rely exclusively on in-memory queues or process-local state.

Do not introduce a separate message broker, distributed tracing platform, or complex monitoring stack until the workload and operational requirements justify it.

## 3. Observability Standards

### 3.1 Structured Logging

Application logs must be structured, machine-readable, and suitable for centralized collection.

Use JSON in production, with fields such as:

- `timestamp`
- `level`
- `service`
- `environment`
- `message`
- `request_id`
- `trace_id`, when available
- `tenant_id`, when appropriate
- `actor_type`, when appropriate
- `operation`
- `duration_ms`
- `error_code`

Not every event needs every field. Logging must preserve privacy and avoid unnecessarily identifying individual users.

Use consistent event names and severity levels:

| Level | Intended use |
|---|---|
| DEBUG | Detailed development diagnostics; normally disabled in production |
| INFO | Normal lifecycle events and important state transitions |
| WARN | Recoverable anomalies, retries, and suspicious conditions |
| ERROR | Failed requests, jobs, or operations requiring investigation |
| FATAL | Process-level failures that prevent safe continued operation |

Do not log passwords, access tokens, full API keys, payment credentials, CVV values, or complete webhook secrets.

Avoid logging complete usage payloads or invoice contents by default. Prefer identifiers, summaries, and safe diagnostic metadata.

### 3.2 Correlation Identifiers

Every incoming API request must receive a server-generated request identifier unless a trusted upstream identifier is accepted under a documented validation policy.

Propagate correlation identifiers through:

- Application service calls.
- Database operation context where useful.
- Outbox records.
- Background jobs.
- External integration requests where supported.

A background job must retain a correlation reference to its originating operation when one exists.

Correlation IDs are diagnostic metadata, not authorization credentials.

### 3.3 Metrics

Metrics must expose system behavior without creating unbounded cardinality.

Use labels such as service, operation, result, job type, and environment where useful.

Do not use raw user IDs, request IDs, invoice IDs, or arbitrary tenant IDs as metric labels. Tenant-specific diagnosis must use controlled logs, traces, and administrative reports.

## 4. Application and Infrastructure Metrics

### 4.1 API Metrics

Collect:

- Request count by route template and status class.
- Request latency, including p50, p95, and p99.
- Error rate.
- Authentication and authorization failures.
- Rate-limit rejections.
- Request validation failures.
- Active requests and process resource utilization.

Monitor latency and errors by route template rather than raw URL paths to avoid excessive metric cardinality.

### 4.2 Database Metrics

Collect:

- Connection-pool utilization.
- Connection acquisition wait time.
- Query latency.
- Transaction duration.
- Deadlocks and lock waits.
- Failed connections.
- Database storage utilization.
- Table and index growth.
- Long-running queries.
- Replication and backup health if those capabilities are deployed.

Database saturation can affect usage ingestion, entitlement checks, invoice generation, and worker throughput simultaneously. Treat it as a shared dependency.

### 4.3 Worker Metrics

Collect:

- Queue depth by job type.
- Age of the oldest pending job.
- Job processing duration.
- Successful and failed job counts.
- Retry counts.
- Dead-letter or terminal-failure counts, if implemented.
- Jobs currently processing.
- Outbox backlog and oldest unprocessed outbox record.
- Worker heartbeat and last successful processing time.

Queue depth alone is insufficient. A small queue containing a very old job can indicate a serious processing failure.

### 4.4 Resource Metrics

Monitor CPU, memory, disk space, network errors, container restarts, and process availability for API and worker instances.

Alert before storage exhaustion or sustained resource pressure threatens service availability.

## 5. Usage Metering Observability

Usage metering requires operational measures that establish whether events are being accepted, processed, aggregated, and made available for billing correctly.

### 5.1 Ingestion Metrics

Track:

- Received events.
- Accepted events.
- Rejected events by safe reason category.
- Duplicate events.
- Conflicting idempotency-key reuse.
- Authentication failures.
- Ingestion latency.
- Batch sizes and partial failures.
- Delayed events and events outside permitted time windows.

A high duplicate rate may indicate normal retries, a client integration defect, or a delivery problem. Interpret it alongside other signals.

### 5.2 Aggregation Metrics

Track:

- Pending aggregation work.
- Aggregation duration.
- Aggregation failures.
- Time since the last successful aggregation.
- Number of affected billing periods.
- Reprocessing attempts.
- Reconciliation discrepancies between accepted events and aggregates.

Define explicit rules for late-arriving events, closed periods, and corrections. Operational tools must not silently rewrite finalized billing records.

### 5.3 Metering Invariants

Periodically verify important invariants, including:

- Every accepted event has a stable identity.
- An event is not counted twice because of retries.
- Aggregates are traceable to their source events or documented correction records.
- Processing failures are visible and recoverable.
- Closed billing periods follow the documented late-event policy.

These checks must use bounded, incremental queries where possible to avoid creating additional production load.

## 6. Subscription, Entitlement, and Quota Observability

Monitor:

- Subscription lifecycle transitions.
- Failed subscription-change operations.
- Entitlement recalculation failures.
- Stale entitlement records.
- Quota enforcement decisions.
- Rejected operations caused by quota limits.
- Quota counter reconciliation discrepancies.
- Concurrent-operation conflicts.
- Unexpected entitlement changes.

Entitlement and quota decisions must be explainable. Where practical, record the relevant subscription version, policy or rule version, and decision outcome.

A customer reporting that access was incorrectly denied must be diagnosable without relying on guesswork or reconstructing the entire production environment.

## 7. Billing and Payment Observability

Billing observability must distinguish successful technical execution from financially correct outcomes.

### 7.1 Invoice Metrics

Track:

- Invoice generation attempts and outcomes.
- Invoices issued per billing cycle.
- Invoice generation latency.
- Failed or delayed invoice generation.
- Draft invoices awaiting action.
- Credit notes and adjustment counts.
- Billing-period processing progress.
- Reconciliation failures.

Monitor unexpected deviations in invoice counts and aggregate totals, while respecting tenant privacy and avoiding sensitive financial information in general-purpose logs.

### 7.2 Payment Metrics

Track:

- Payment attempts by outcome.
- Provider API latency and errors.
- Webhook receipt and verification failures.
- Duplicate webhook deliveries.
- Time between webhook receipt and processing.
- Payments awaiting reconciliation.
- Unexpected payment state transitions.
- Refund processing failures.

Provider-specific error codes may be retained in restricted diagnostic records where necessary, but secrets and sensitive payment data must be excluded.

### 7.3 Financial Reconciliation

Provide a repeatable reconciliation process that compares internal payment and invoice records with authoritative provider records.

The process must identify:

- Internal payments marked successful without sufficient provider confirmation.
- Provider-confirmed payments not reflected internally.
- Amount or currency mismatches.
- Duplicate processing.
- Refund discrepancies.
- Unresolved or stale payment attempts.

Reconciliation must report discrepancies rather than silently force records into agreement.

Any corrective action must follow approved financial state transitions and produce an audit record.

Issued invoices remain immutable. Corrections must use explicit financial adjustments or credit notes.

## 8. Health Checks

Expose separate health endpoints for orchestration and operational diagnosis.

### 8.1 Liveness

A liveness endpoint indicates whether the process is running sufficiently to continue.

It must not fail simply because PostgreSQL or a payment provider is temporarily unavailable. Otherwise, a dependency outage could trigger unnecessary restart loops.

### 8.2 Readiness

A readiness endpoint indicates whether the instance can safely serve its assigned workload.

For the API, readiness must account for essential initialization and database availability.

For workers, readiness must account for successful initialization, valid configuration, and the ability to perform required processing.

Optional integrations must not automatically make the entire platform unready unless the affected service cannot safely perform its assigned role.

### 8.3 Dependency Health

Provide restricted diagnostics for dependencies such as PostgreSQL, IAM, and payment providers.

Do not expose internal connection strings, credentials, stack traces, or infrastructure details through public health endpoints.

Health checks must be lightweight and must not create excessive database or provider traffic.

## 9. Alerts and Severity

Alerts must be actionable and tied to an owner or response procedure.

### 9.1 Alert Conditions

| Condition | Severity | Response |
|---|---|---|
| API unavailable or sustained elevated error rate | High | Investigate availability and recent changes |
| Database unavailable | Critical | Restore database connectivity and assess impact |
| Sustained high API latency | High | Investigate saturation and slow dependencies |
| Oldest job exceeds its processing objective | High | Inspect worker health and blocked jobs |
| Usage aggregation falls behind its objective | High | Investigate ingestion and processing backlog |
| Payment webhook backlog grows unexpectedly | High | Inspect webhook intake and worker processing |
| Financial reconciliation finds unexplained discrepancies | Critical or high, based on impact | Preserve evidence and investigate before correction |
| Backup verification fails | High | Repair backup process and reassess recovery readiness |
| Disk usage approaches capacity | High | Expand or safely reclaim capacity |
| Repeated authorization failures indicate possible abuse | Medium to high | Investigate source and affected resources |

These are initial alert categories, not universal numerical thresholds. Actual thresholds must be configured against measured workloads and agreed service objectives.

### 9.2 Alert Quality

Avoid alerting on every isolated transient failure.

Use sustained thresholds, error budgets, and rate-of-change signals where appropriate. Group related alerts to prevent a single database outage from generating an unmanageable volume of notifications.

Critical financial-integrity alerts must not be suppressed merely because overall API availability remains healthy.

## 10. Service Objectives

Define service-level indicators (SLIs) and service-level objectives (SLOs) after measuring the initial deployment.

Potential indicators include:

- API availability and successful-request rate.
- API p95 and p99 latency.
- Usage ingestion success and latency.
- Maximum acceptable usage aggregation delay.
- Maximum age of pending billing jobs.
- Payment webhook processing delay.
- Successful completion of scheduled invoice generation.
- Backup completion and restore-test success.

SLOs must identify the measurement window, eligible requests, exclusions, and the relevant customer impact.

Do not promise immediate usage aggregation or instantaneous payment reconciliation unless the architecture and measured performance support those commitments.

## 11. Background Job Operations

### 11.1 Retry Policy

Retry transient failures using bounded exponential backoff with jitter.

Examples of potentially transient failures include temporary database contention and provider rate limits. Validation failures and invalid credentials generally require correction rather than unlimited retries.

Every job type must define:

- Maximum attempts.
- Retryable failure categories.
- Backoff strategy.
- Timeout.
- Idempotency requirements.
- Terminal-failure behavior.
- Operator recovery procedure.

### 11.2 Terminal Failures

Jobs that exhaust retries must remain observable and recoverable.

Record a safe failure category, attempt count, last-attempt timestamp, and relevant resource references.

Sensitive payloads must not be copied into unrestricted error logs.

Provide administrative tooling or controlled operational commands to inspect, retry, or resolve failed jobs. Retrying a financial job must not bypass its idempotency or authorization controls.

### 11.3 Job Recovery

A recovery operation must distinguish between:

- Reprocessing an existing job.
- Rebuilding a derived aggregate.
- Correcting an underlying source record.
- Issuing a financial adjustment.

These actions have different effects and must not be treated as interchangeable.

## 12. Database Operations

### 12.1 Migrations

Database schema changes must be version-controlled and applied through a repeatable migration process.

For production changes:

- Review destructive operations.
- Prefer backward-compatible changes where feasible.
- Separate large data migrations from short schema changes.
- Avoid holding long-running locks during peak usage.
- Define rollback or forward-recovery procedures.
- Verify migration completion before enabling dependent application behavior.

A migration rollback is not always safe after financial or usage data has been written. Prefer a tested forward-recovery plan when reversing the migration could lose or corrupt data.

### 12.2 Connection Management

Configure bounded connection pools for API and worker processes.

The combined maximum connection allocation must remain within PostgreSQL's practical capacity, with reserved headroom for administration and recovery.

Monitor connection exhaustion, transaction duration, and idle transactions.

### 12.3 Data Maintenance

Establish maintenance procedures for:

- Vacuuming and analyzing tables.
- Index health and growth.
- Partitioning, if later justified by volume.
- Retention and archival.
- Database storage expansion.
- Large backfills and re-aggregation jobs.

Do not introduce partitioning or elaborate database sharding before measured data volume and query behavior justify them.

## 13. Backup and Disaster Recovery

### 13.1 Backup Policy

Production data must have automated backups appropriate to its financial and operational importance.

The policy must define:

- Backup frequency.
- Retention duration.
- Encryption.
- Storage location and access restrictions.
- Backup failure alerts.
- Recovery-point objective (RPO).
- Recovery-time objective (RTO).

Backups must be protected against accidental deletion and unauthorized modification. Maintain a recovery path that does not depend entirely on the primary production environment.

### 13.2 Restore Testing

A successful backup job does not prove that the data can be restored.

Perform periodic restoration tests in an isolated environment. Verify:

- Database integrity.
- Required schema and migration state.
- Tenant relationships and financial records.
- Availability of necessary encryption keys and configuration.
- Application startup and essential workflows.
- Reconciliation and job recovery after restoration.

Document the result, recovery duration, and identified gaps.

### 13.3 Recovery Semantics

After restoration, determine which jobs and integrations require reconciliation or replay.

Usage ingestion and financial processing must remain idempotent during recovery. Do not replay provider events or issue invoices blindly.

If an external payment provider has advanced beyond the restored internal state, reconcile against authoritative provider records before resuming affected financial operations.

## 14. Deployment and Release Operations

Deploy the frontend, API, and worker through controlled, versioned releases.

The release process must include:

1. Automated tests and static checks.
2. Dependency and container security checks.
3. Build artifact creation.
4. Migration compatibility checks.
5. Deployment to the target environment.
6. Health and readiness verification.
7. Smoke tests for critical workflows.
8. Monitoring of error rates, latency, and worker backlog.
9. A documented rollback or forward-recovery decision.

Where possible, API and worker deployments must support temporary overlap between compatible versions.

Job payloads and persisted records must remain compatible across the deployment window. A newly deployed worker must not fail unpredictably on jobs created by the previous release.

Feature flags or staged activation may be used for risky changes, but must not become a substitute for database integrity or authorization.

## 15. Environment Separation

Maintain distinct development, testing, staging, and production environments.

Each environment must have separate credentials and appropriate access controls.

Production data must not be copied into lower environments without an approved process that protects sensitive information. Prefer synthetic or anonymized data for development and automated tests.

Staging must exercise the production deployment process and relevant integrations without accidentally issuing real charges or sending unintended customer communications.

Payment-provider sandbox credentials must be separated from production credentials.

## 16. Operational Runbooks

Maintain concise, version-controlled runbooks for recurring incidents.

At minimum, document procedures for:

- API availability incidents.
- Database connection exhaustion.
- Usage ingestion failures.
- Delayed or failed aggregation.
- Stuck or repeatedly failing jobs.
- Subscription or entitlement inconsistencies.
- Invoice generation failures.
- Payment webhook backlog.
- Payment reconciliation discrepancies.
- Suspected cross-tenant access.
- Credential compromise.
- Failed backups and restoration.
- Failed or partially completed deployments.

Each runbook must contain symptoms, diagnostic queries or commands, safety precautions, remediation steps, escalation criteria, and verification steps.

Operational commands must respect authorization, preserve audit records, and avoid destructive default behavior.

## 17. Incident Management

For a production incident:

1. Determine scope and customer impact.
2. Assign an incident owner.
3. Preserve relevant logs, metrics, and audit records.
4. Contain the immediate failure or security exposure.
5. Restore safe operation.
6. Reconcile affected usage, billing, or payment records.
7. Verify that the underlying problem is resolved.
8. Document the cause, impact, and corrective actions.

Security incidents and financial-integrity incidents require particular care. Avoid deleting evidence, silently modifying invoices, or applying unverified bulk corrections during recovery.

Post-incident reviews must focus on system improvements and actionable prevention rather than individual blame.

## 18. Operational Access and Change Control

Production access must follow least privilege.

- Restrict database administration to authorized operators.
- Audit sensitive operational actions.
- Require explicit confirmation for destructive or financially significant commands.
- Prefer reviewed scripts and repeatable procedures over undocumented manual edits.
- Use time-limited elevated access where supported.
- Maintain an audit trail for emergency changes.
- Review production access periodically.

Manual changes to authoritative financial records are prohibited outside documented correction procedures.

## 19. Operational Acceptance Criteria

The platform is ready for production operation when:

- [ ] API, database, and worker health are observable independently.
- [ ] Structured logs include useful correlation identifiers.
- [ ] API latency, error rates, and resource saturation are monitored.
- [ ] Worker backlog, retry behavior, and terminal failures are visible.
- [ ] Usage ingestion and aggregation have measurable health indicators.
- [ ] Billing and payment reconciliation can identify discrepancies.
- [ ] Critical alerts have documented response procedures.
- [ ] Database migrations follow a controlled release process.
- [ ] Automated backups and restore tests are established.
- [ ] RPO and RTO are defined and tested.
- [ ] Operational runbooks cover critical failure scenarios.
- [ ] Deployments include health verification and rollback or recovery planning.
- [ ] Sensitive data is excluded from unrestricted logs.
- [ ] Operational access and emergency changes are auditable.

## 20. Implementation Principles

1. Monitor business correctness alongside infrastructure availability.
2. Treat PostgreSQL as the authoritative store for durable platform state.
3. Make background processing observable, retry-safe, and recoverable.
4. Distinguish technical success from correct usage and financial outcomes.
5. Reconcile discrepancies explicitly rather than silently rewriting records.
6. Start with a small, actionable monitoring baseline and expand based on evidence.
7. Test recovery procedures rather than assuming that backups and retries are sufficient.
8. Keep operational procedures repeatable, reviewable, and safe.

These requirements establish the operational baseline for the Tally. Production readiness depends on measurable objectives, tested recovery, and the ability to explain and correct failures without compromising tenant isolation or financial integrity.