# Testing Strategy

## 1. Purpose

This document defines the testing strategy for the Tally.

The platform processes usage events, evaluates entitlements and quotas, manages subscriptions, generates invoices, and integrates with payment providers. Testing must protect both technical correctness and commercial integrity.

The strategy prioritizes:

- Correctness of domain rules.
- Tenant isolation and authorization.
- Accurate, idempotent usage processing.
- Financial consistency.
- Reliable background processing.
- API contract stability.
- Safe database migrations and deployments.
- Reproducible automated verification in CI.

Testing must be automated wherever practical and must not depend on production data or live payment transactions.

## 2. Testing Principles

1. **Test behavior, not implementation details.** Tests must verify observable outcomes and business invariants.
2. **Test financial logic deterministically.** Money calculations, pricing, rounding, and invoice totals must have explicit expected results.
3. **Test failure paths.** Retries, duplicates, timeouts, concurrency, and partial failures are normal operating conditions.
4. **Test tenant boundaries explicitly.** Authorization defects must be treated as critical failures.
5. **Use real PostgreSQL for database integration tests.** Mocks alone cannot validate SQL constraints, transaction behavior, locking, or row-level security.
6. **Keep tests isolated and repeatable.** Test results must not depend on execution order, wall-clock timing, or shared mutable data.
7. **Test externally observable contracts.** API behavior and persisted state matter more than internal class structure.
8. **Make the critical path fast.** Run inexpensive tests on every change and reserve heavier suites for appropriate CI stages.

## 3. Testing Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend unit tests | Jest | Domain rules and service behavior |
| Backend HTTP tests | Supertest | NestJS endpoint behavior |
| Database integration tests | Testcontainers with PostgreSQL | SQL, transactions, constraints, migrations |
| Frontend unit tests | Vitest | UI logic and component behavior |
| Frontend component tests | React Testing Library | User-visible interaction |
| End-to-end tests | Playwright | Critical user workflows across the application |
| API contract | OpenAPI validation and automated contract checks | Request/response compatibility |
| Static analysis | TypeScript checks and linting | Early detection of defects |
| Dependency security | Automated dependency scanning | Vulnerable dependency detection |

Exact versions must be pinned or constrained through project manifests and lockfiles.

## 4. Testing Pyramid

### 4.1 Unit Tests

Unit tests validate isolated business rules without starting the HTTP server or database.

Examples:

- Meter unit conversion.
- Usage event validation.
- Pricing calculation.
- Subscription transition rules.
- Entitlement resolution.
- Quota decision logic.
- Invoice total calculation.
- Currency precision and rounding.
- Payment state transitions.
- Idempotency conflict detection.

Unit tests must be numerous, fast, and deterministic.

### 4.2 Integration Tests

Integration tests verify that modules work correctly with PostgreSQL, NestJS, and relevant external-service adapters.

Examples:

- Creating and changing subscriptions.
- Persisting usage events and aggregating them.
- Enforcing unique event identifiers.
- Generating invoices inside database transactions.
- Claiming and retrying jobs safely.
- Recording webhook events and processing them idempotently.
- Enforcing tenant-scoped queries.
- Applying database migrations to a clean database.

These tests must use a real PostgreSQL instance, preferably provisioned through Testcontainers in CI.

### 4.3 End-to-End Tests

End-to-end tests exercise critical workflows through the frontend and API.

Examples:

- A tenant administrator views an active subscription.
- An authorized integration submits usage.
- Usage becomes available for billing.
- An invoice is generated and displayed.
- A simulated payment-provider event updates payment status.
- A user without billing permission is denied access to billing operations.
- One tenant cannot access another tenant's invoice.

Use deterministic fixtures and provider simulators rather than live financial transactions.

## 5. Backend Unit Testing

### 5.1 Domain Rules

Domain logic must be testable independently of NestJS controllers and database infrastructure.

Test both valid and invalid transitions for:

- Subscription lifecycle.
- Entitlement calculation.
- Quota evaluation.
- Meter configuration.
- Usage event acceptance.
- Invoice lifecycle.
- Payment lifecycle.
- Refund and credit-note rules.

For every important rule, include at least one normal case, one boundary case, and one invalid case.

### 5.2 Monetary Calculations

Use integer minor units or an appropriate exact decimal representation. Never use binary floating-point arithmetic for authoritative financial calculations.

Test:

- Currency precision.
- Pricing rates and quantities.
- Rounding rules.
- Tax calculations where supported.
- Discounts and adjustments.
- Zero-value invoices.
- Negative or invalid quantities.
- Large values and overflow boundaries.
- Consistent subtotal, tax, adjustment, and total calculations.

The expected rounding behavior must be specified by the billing domain rather than left to incidental language or database defaults.

### 5.3 Time and Billing Periods

Inject a controllable clock into time-sensitive services.

Test:

- Billing-period boundaries.
- UTC normalization.
- Month-end and year-end transitions.
- Leap years.
- Delayed usage events.
- Subscription changes during a billing period.
- Grace periods and expiration.
- Retry scheduling.
- Invoice generation around period closure.

Tests must not rely on whichever date happens to be current when CI runs.

## 6. Database Integration Testing

### 6.1 Real PostgreSQL

Integration tests must validate behavior against the PostgreSQL version supported in deployment.

Use isolated databases or schemas with controlled cleanup. Do not allow concurrent tests to share mutable financial fixtures without appropriate isolation.

Verify:

- Unique constraints.
- Foreign keys.
- Check constraints.
- Composite tenant-scoped relationships.
- Transaction rollback.
- Isolation and locking behavior.
- Idempotency constraints.
- Index-supported query patterns for important operations.
- Migration compatibility.

### 6.2 Migration Testing

Every schema change must be tested against:

1. A clean database initialized from migrations.
2. A representative database created from the previous supported schema.
3. Existing records that exercise relevant constraints and relationships.

Where deployment uses an expand-and-contract migration strategy, test compatibility between the intermediate schema and application versions that overlap during rollout.

A migration must not silently delete or corrupt usage, subscription, invoice, or payment records.

### 6.3 Row-Level Security

If PostgreSQL Row-Level Security is enabled, tests must verify:

- Authorized tenant access succeeds.
- Cross-tenant reads and writes fail.
- Missing tenant context denies access where required.
- Connection-pool reuse does not leak tenant context.
- Administrative database roles do not unintentionally bypass policies.

Application-level authorization tests remain mandatory even when RLS is enabled.

## 7. Tenant Isolation and Authorization Testing

Tenant isolation is a release-blocking security invariant.

Create at least two independent tenants with separate users, subscriptions, usage records, and invoices.

Verify that a principal from Tenant A cannot read, modify, delete, export, or trigger operations against Tenant B's resources.

Test attacks involving:

- Replacing resource IDs in URL paths.
- Changing tenant IDs in request bodies or headers.
- Manipulating pagination and filters.
- Guessing or reusing idempotency keys.
- Accessing nested resources through another tenant's parent identifier.
- Invoking background operations against unauthorized records.
- Using expired, invalid, or insufficiently scoped credentials.
- Accessing platform-only operations with customer permissions.

Every endpoint that handles tenant-owned resources must have positive and negative authorization coverage.

The tests must verify persisted state as well as HTTP responses. Returning `403` or `404` is insufficient if an unauthorized mutation occurred before the response.

## 8. Usage Metering Tests

### 8.1 Event Ingestion

Test:

- Valid event acceptance.
- Invalid event rejection.
- Authentication and tenant association.
- Unsupported meters and units.
- Invalid timestamps.
- Negative or excessive quantities where prohibited.
- Duplicate event delivery.
- Conflicting reuse of event identifiers.
- Batch limits and partial failures.
- Client retries after a timeout.

A retry must not create duplicate billable usage.

### 8.2 Aggregation

Verify that aggregates match accepted source events according to the configured meter and aggregation rules.

Test:

- Sum, count, maximum, or other supported aggregation methods.
- Duplicate suppression.
- Out-of-order arrival.
- Delayed events.
- Concurrent aggregation attempts.
- Reprocessing after worker failure.
- Correction records.
- Billing-period closure behavior.

Where the design supports replay or re-aggregation, verify that repeating the operation produces the correct final result without unintended duplicate charges.

### 8.3 Usage Invariants

Tests must enforce these invariants:

- Each accepted event has a stable identity.
- A duplicate event does not create a second billable effect.
- Rejected events do not affect accepted usage totals.
- Aggregates can be reconciled with their source records.
- Unauthorized sources cannot submit billable usage for another tenant.
- Late events follow the documented billing-period policy.

## 9. Subscription, Entitlement, and Quota Tests

Test the subscription lifecycle, including valid changes, invalid transitions, cancellation, expiration, and renewal behavior where supported.

Verify that entitlement resolution reflects the correct subscription and effective policy.

For quota enforcement, test:

- Requests below the limit.
- Requests at the limit.
- Requests exceeding the limit.
- Missing or unlimited quota configuration where supported.
- Subscription changes that affect quotas.
- Counter resets at period boundaries.
- Concurrent requests competing for remaining capacity.
- Retry behavior after a timeout or database conflict.

Concurrent quota tests must demonstrate that the system cannot approve more usage than the defined enforcement semantics permit.

If enforcement is intentionally eventual rather than strictly atomic, document and test the allowed overshoot behavior.

## 10. Billing and Invoicing Tests

### 10.1 Invoice Calculation

Test invoice calculations from persisted usage and the applicable pricing configuration.

Verify:

- Correct billing-period selection.
- Correct meter and pricing association.
- Quantity and unit conversion.
- Currency consistency.
- Subtotal and total calculation.
- Rounding.
- Discounts, taxes, and adjustments where supported.
- Empty or zero-value periods.
- Missing pricing configuration.
- Large invoices and boundary values.

Tests must establish that clients cannot directly set authoritative invoice totals.

### 10.2 Invoice Lifecycle

Verify that:

- Draft invoices may be changed only through authorized operations.
- Issuance follows the required validation rules.
- Issued invoices cannot be silently mutated.
- Corrections produce explicit adjustment or credit-note records.
- Duplicate billing jobs do not issue duplicate invoices.
- Concurrent invoice-generation attempts preserve uniqueness and consistency.

### 10.3 Billing Idempotency

Run the same billing operation repeatedly and verify that it produces the intended single commercial outcome.

Test failure scenarios where a worker:

- Crashes before committing.
- Commits before acknowledging job completion.
- Times out while the caller does not know whether the operation succeeded.
- Receives the same job more than once.
- Encounters a concurrent attempt for the same tenant and billing period.

The system must recover without creating duplicate invoices or losing committed financial records.

## 11. Payment Integration Tests

Payment tests must use a fake provider, sandbox, or controlled test adapter.

Verify:

- Successful payment initiation.
- Provider timeout and unavailable responses.
- Declined or failed payments.
- Duplicate webhook delivery.
- Invalid webhook signatures.
- Replay attempts.
- Out-of-order events.
- Mismatched amounts or currencies.
- Unknown provider references.
- Duplicate refund requests.
- Reconciliation of inconsistent states.

A successful HTTP response from a provider is not automatically equivalent to a completed payment. Tests must verify the platform's documented payment state machine.

No automated test must initiate a real charge against a production payment account.

## 12. Background Worker Testing

Worker tests must verify durable and retry-safe processing.

Test:

- Successful job execution.
- Transient failure and retry.
- Permanent failure and terminal status.
- Worker crash during processing.
- Duplicate job delivery.
- Expired processing leases, if leases are used.
- Concurrent workers claiming available jobs.
- Outbox delivery after transaction commit.
- Recovery after an interrupted deployment.
- Safe reprocessing of failed jobs.

At-least-once execution is the default assumption. Tests must not depend on exactly-once delivery.

Every job type must have a documented idempotency strategy appropriate to its side effects.

## 13. API Contract Testing

The OpenAPI specification is the authoritative API contract.

Validate that:

- Routes and methods match the specification.
- Required fields and types are enforced.
- Response schemas remain compatible.
- Error responses use the documented structure.
- Authentication and permission requirements are represented correctly.
- Pagination and timestamp formats are consistent.
- Monetary values use the documented representation.
- Idempotency requirements are documented for relevant operations.

Generate or validate client types from OpenAPI where practical.

Changes that break existing clients must be identified during review and handled through an explicit compatibility or versioning decision.

## 14. Frontend Testing

### 14.1 Component Tests

Use Vitest and React Testing Library to test user-visible behavior.

Cover:

- Loading, empty, success, and error states.
- Form validation.
- Permission-dependent actions.
- Subscription and entitlement displays.
- Usage summaries.
- Invoice lists and details.
- Payment status messages.
- Pagination and filtering.
- Retry and recovery guidance.

Tests must interact with components as a user would rather than relying heavily on internal implementation details.

### 14.2 API Error Handling

Verify that the frontend handles:

- Authentication expiration.
- Authorization failures.
- Rate limits.
- Validation errors.
- Network timeouts.
- Server errors.
- Duplicate submission responses.

The UI must not represent a payment as successful solely because the user clicked a payment button.

### 14.3 Financial Display

Verify currency formatting, decimal precision, totals, timestamps, and invoice status presentation.

Frontend calculations may support presentation, but the server remains authoritative for financial values.

## 15. End-to-End Critical Workflows

Playwright must cover the following workflows:

### Workflow A: Subscription Setup

1. Authenticate as an authorized tenant administrator.
2. View available plans.
3. Create or change a subscription.
4. Verify the resulting subscription state.
5. Verify entitlement changes.

### Workflow B: Usage to Invoice

1. Submit valid usage through an authorized integration.
2. Verify event acceptance.
3. Process aggregation.
4. Generate the billing-period invoice.
5. Verify invoice quantities and totals.
6. Verify the invoice appears in the customer interface.

### Workflow C: Payment Confirmation

1. Initiate a test payment.
2. Deliver a valid simulated provider event.
3. Verify the payment state transition.
4. Deliver the same event again.
5. Verify that no duplicate financial effect occurs.

### Workflow D: Tenant Isolation

1. Authenticate as Tenant A.
2. Attempt to access Tenant B's invoice and usage records.
3. Verify denial.
4. Verify Tenant B's data remains unchanged.

### Workflow E: Failure Recovery

1. Create a job that encounters a controlled transient failure.
2. Verify retry scheduling.
3. Restore the dependency.
4. Verify successful completion.
5. Confirm that usage or billing effects were not duplicated.

End-to-end tests must focus on a small number of high-value workflows. Detailed edge cases belong primarily in unit and integration tests.

## 16. Concurrency and Resilience Testing

Use integration tests to exercise concurrent operations against PostgreSQL.

Prioritize:

- Simultaneous quota consumption.
- Concurrent subscription changes.
- Duplicate invoice generation.
- Concurrent payment-event processing.
- Multiple workers claiming the same job.
- Simultaneous requests using the same idempotency key.

Verify database invariants after all competing transactions complete.

Introduce controlled dependency failures to test bounded retries, transaction rollback, and recovery behavior.

Load and stress testing must be added before major scale increases or significant architectural changes. Avoid setting performance targets without measuring the intended workload and deployment environment.

## 17. Security Testing

Security tests must include:

- Tenant isolation and resource authorization.
- Invalid or insufficiently scoped credentials.
- Input validation and payload limits.
- Rate limiting.
- Webhook signature verification.
- Secret redaction.
- Unsafe URL and redirect handling.
- Dependency vulnerability checks.
- Database privilege and RLS verification, if applicable.
- Protection against mass assignment and unauthorized state changes.

Critical authorization and financial-integrity tests must run on every relevant pull request.

A vulnerability scanner passing does not prove that tenant isolation or business authorization is correct.

## 18. Test Data Management

Use deterministic fixtures and factories to create test data.

Test data must represent realistic relationships among:

- Tenants and users.
- Plans and meters.
- Subscriptions and entitlements.
- Usage events and aggregates.
- Billing periods and invoices.
- Payment attempts and provider events.

Requirements:

- Use synthetic identities and financial records.
- Never depend on production customer data.
- Avoid sharing mutable records between parallel tests.
- Reset state deterministically.
- Keep test fixtures small and focused.
- Include boundary cases and malformed inputs.
- Make failures reproducible from recorded inputs and configuration.

## 19. Continuous Integration

The CI pipeline must execute progressively more expensive checks.

### Stage 1: Fast Checks

- Formatting and linting.
- TypeScript type checking.
- Backend unit tests.
- Frontend unit and component tests.
- OpenAPI validation.

### Stage 2: Integration Checks

- PostgreSQL Testcontainers startup.
- Migration validation.
- Database integration tests.
- Tenant-isolation tests.
- Usage, quota, billing, and worker tests.

### Stage 3: End-to-End and Security Checks

- Critical Playwright workflows.
- Dependency vulnerability scanning.
- Container image scanning where configured.
- Additional migration and release-compatibility checks.

The pipeline must fail when required tests fail. Flaky tests must be investigated and corrected rather than routinely ignored or automatically retried until they pass.

## 20. Coverage and Quality Gates

Code coverage is a diagnostic tool, not a substitute for meaningful assertions.

Track coverage by module, with particular attention to:

- Usage ingestion and aggregation.
- Subscription and entitlement rules.
- Quota enforcement.
- Pricing and invoice calculation.
- Payment state transitions.
- Tenant authorization.
- Idempotency and retry behavior.

Set an initial coverage target after the baseline test suite exists. Enforce stronger quality gates for critical financial and security modules.

A release must not proceed with known failures in tenant isolation, financial integrity, or migration safety merely because aggregate coverage is high.

## 21. Test Failure Diagnosis

When a test fails:

1. Identify whether the failure is in domain logic, infrastructure, fixtures, or the test itself.
2. Preserve relevant logs and test inputs.
3. Reproduce the failure locally or in an isolated CI environment.
4. Verify the actual persisted state when testing transactions or background jobs.
5. Correct the underlying defect.
6. Add or improve a regression test.

Tests must not be weakened merely to accommodate incorrect application behavior.

## 22. Acceptance Criteria

The testing strategy is ready for implementation when:

- [ ] Backend unit tests cover critical domain rules.
- [ ] Financial calculations use exact arithmetic and explicit rounding tests.
- [ ] PostgreSQL integration tests run against a real PostgreSQL instance.
- [ ] Tenant isolation is verified across API and persisted state.
- [ ] Usage ingestion and aggregation are tested for duplicates and retries.
- [ ] Subscription, entitlement, and quota transitions are covered.
- [ ] Invoice generation is tested for concurrency and idempotency.
- [ ] Payment webhooks are tested for forgery, replay, and duplicate delivery.
- [ ] Background workers are tested for crashes and recovery.
- [ ] OpenAPI contracts are validated in CI.
- [ ] Critical frontend workflows have automated end-to-end coverage.
- [ ] Security and dependency checks run in the pipeline.
- [ ] Test data is synthetic, deterministic, and isolated.
- [ ] Critical security and financial failures block release.

## 23. Implementation Principles

1. Prefer deterministic tests over timing-dependent tests.
2. Use mocks for external boundaries, but use real PostgreSQL for database guarantees.
3. Treat duplicate delivery, retries, and concurrency as expected conditions.
4. Verify persisted outcomes for operations with financial or security implications.
5. Make critical invariants explicit and executable as tests.
6. Keep unit tests fast and integration tests reproducible.
7. Use end-to-end tests for complete customer workflows rather than every edge case.
8. Require automated evidence before releasing changes to billing, usage, authorization, or database constraints.

This strategy establishes a testable foundation for the platform. Correctness, tenant isolation, and financial integrity are mandatory properties—not optional quality improvements.