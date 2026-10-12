# Deployment and Environments

## 1. Purpose

This document defines the deployment architecture, environment separation, configuration management, release process, and production operations for the Tally.

The deployment model must support reliable releases, safe database changes, background processing, and recovery without introducing unnecessary infrastructure complexity.

The initial deployment uses Docker and Docker Compose, PostgreSQL, a NestJS API, a separate worker process, and a React frontend built with Vite.

The architecture must remain suitable for a modular monolith. Separate API and worker processes do not require separate repositories, independently managed microservices, or a Kubernetes deployment.

## 2. Deployment Objectives

The deployment architecture must provide:

- Reproducible builds and deployments.
- Clear separation between development, testing, staging, and production.
- Secure handling of credentials and environment-specific configuration.
- Controlled database migrations.
- Reliable background job processing.
- Persistent storage for authoritative data.
- Health checks and deployment verification.
- Backup and restoration capabilities.
- A documented recovery strategy for failed releases.
- A straightforward path to additional application instances when required.

## 3. Initial Deployment Architecture

The initial production environment consists of the following logical components:

| Component | Responsibility |
|---|---|
| Frontend | Serves the compiled React application |
| API | Handles REST requests, authentication integration, authorization, and domain operations |
| Worker | Processes durable background jobs and outbox events |
| PostgreSQL | Stores authoritative platform data |
| Reverse proxy or ingress | Terminates TLS and routes requests |
| External IAM | Provides identity and authentication services |
| Payment providers | Handle external payment operations |
| Backup storage | Stores protected database backups |
| Monitoring system | Collects logs, metrics, and alerts |

The API and worker must be separate runtime processes using the same application codebase and domain modules.

The frontend must be built into static assets and served by an appropriate web server or deployment platform. It must not require a development server in production.

PostgreSQL is the authoritative store for business state. Application containers must not depend on local container filesystems for durable usage, invoice, subscription, or payment records.

## 4. Containerization

### 4.1 Application Images

Build separate deployable images for:

- Frontend.
- API.
- Worker.

The API and worker may share a common base image or application artifact, provided their runtime commands and permissions remain distinct.

Production images must:

- Use maintained base images.
- Pin or constrain dependencies through lockfiles.
- Run as non-root where feasible.
- Exclude development dependencies where appropriate.
- Avoid embedding secrets.
- Include required health-check or diagnostic capabilities.
- Use explicit startup commands.
- Minimize unnecessary packages and filesystem permissions.

Build images in CI and promote the same tested artifact through staging and production. Avoid rebuilding different images for each environment from the same source revision.

### 4.2 Container Lifecycle

Containers must tolerate termination and restart.

The API must stop accepting new work and finish or safely abandon in-flight requests within a configured shutdown window.

Workers must stop claiming new jobs during shutdown and allow active work to finish where possible. Interrupted work must remain recoverable through the durable job mechanism.

A forced termination must not result in silently lost usage events or financial operations.

### 4.3 Image Versioning

Every release image must have a traceable version, such as a release identifier or source commit reference.

Production deployments must use immutable image digests or equivalent immutable artifact references where supported.

Avoid relying exclusively on mutable tags such as `latest`.

Record the deployed versions of the frontend, API, and worker so that incidents can be correlated with a specific release.

## 5. Environment Model

Maintain four logical environments.

### 5.1 Development

Purpose: rapid local development and debugging.

Characteristics:

- Docker Compose or equivalent local services.
- Local PostgreSQL with synthetic data.
- Test IAM configuration or a controlled development identity provider.
- Payment-provider sandbox or fake provider.
- Verbose diagnostics where safe.
- Disposable data where practical.

Development must not use production secrets or initiate real customer charges.

### 5.2 Testing

Purpose: automated unit, integration, and end-to-end testing.

Characteristics:

- Isolated databases.
- Deterministic fixtures.
- Synthetic tenant and financial records.
- Real PostgreSQL for integration tests.
- Simulated external services or sandbox credentials.
- Automated database initialization and cleanup.

Tests must not depend on shared mutable state from other environments.

### 5.3 Staging

Purpose: validate release artifacts and production-like deployment procedures.

Characteristics:

- Production-like configuration structure.
- Separate database and credentials.
- The same release artifacts intended for production.
- Controlled external integrations.
- Health checks and operational monitoring.
- Deployment, migration, and recovery rehearsals.

Staging must not accidentally issue live charges, send unintended customer notifications, or access production customer records.

### 5.4 Production

Purpose: serve real customers and maintain authoritative commercial records.

Characteristics:

- Restricted administrative access.
- TLS-enabled public endpoints.
- Protected secrets.
- Persistent PostgreSQL storage.
- Automated backups.
- Monitoring and alerting.
- Controlled migrations.
- Audited operational actions.
- Tested restoration and incident-response procedures.

Production configuration must fail closed when required security settings are absent or invalid.

## 6. Configuration Management

### 6.1 Configuration Sources

Separate application configuration from source code and deployable artifacts.

Use environment variables for non-secret runtime configuration where appropriate. Use a secret manager or protected deployment configuration for credentials and sensitive keys.

Configuration categories include:

- Runtime environment.
- Public application URL.
- API port and allowed origins.
- PostgreSQL connection settings.
- Connection-pool limits.
- IAM issuer, audience, and client settings.
- Payment-provider selection and credentials.
- Webhook verification settings.
- Job concurrency and retry limits.
- Logging and metrics configuration.
- Billing and usage processing limits.
- Backup and retention settings.

### 6.2 Validation

Validate configuration during startup.

The application must reject:

- Missing required secrets.
- Invalid database URLs.
- Unsupported provider configuration.
- Invalid numeric limits.
- Malformed public URLs.
- Inconsistent environment settings.
- Unsafe production defaults.

Do not silently replace missing production credentials with development values.

### 6.3 Public and Secret Configuration

Frontend build-time variables must be treated as public because they may be embedded in client assets.

Never place database credentials, payment-provider secrets, private signing keys, or other confidential values in frontend environment variables.

Only explicitly approved public configuration may be exposed to the browser.

### 6.4 Configuration Changes

Changes to sensitive production configuration must be controlled and auditable.

Credential rotation must support a safe transition period where the external provider permits it. Verify the new credential before retiring the old one.

Changes to billing behavior, pricing, quota enforcement, or webhook verification must follow the appropriate review and validation procedures.

## 7. Networking and Access

### 7.1 Public Endpoints

Expose only the endpoints required for the application, typically:

- Frontend application.
- Versioned REST API.
- Explicitly configured provider webhook endpoints.

PostgreSQL must not be publicly exposed.

Administrative endpoints, internal diagnostics, and development interfaces must not be publicly accessible without an approved access-control design.

### 7.2 Internal Communication

API and worker processes must communicate through PostgreSQL-backed durable state or explicitly defined internal interfaces.

Use restricted container networks and database permissions.

Avoid unnecessary inbound ports and unrestricted outbound network access.

Payment-provider and IAM connectivity must be configured explicitly. Outbound requests must follow the security controls established in the security architecture.

### 7.3 TLS

Production traffic must use HTTPS.

Manage certificates through the chosen ingress, reverse proxy, or deployment platform. Certificate renewal and expiry must be monitored.

Redirect HTTP requests to HTTPS where appropriate, while ensuring provider callbacks and health checks follow the deployment's documented routing requirements.

## 8. PostgreSQL Deployment

### 8.1 Persistence

PostgreSQL must use persistent storage appropriate to the environment.

Container recreation or application redeployment must not destroy production database contents.

Development databases may be disposable, but production storage must be independently managed and backed up.

### 8.2 Credentials and Permissions

Use separate database credentials or roles where useful for:

- Application runtime.
- Database migrations.
- Operational administration.
- Automated tests.

The normal application role must not have unrestricted database-administration privileges.

Migration privileges must not be exposed to ordinary runtime processes unless the deployment architecture explicitly requires that arrangement.

### 8.3 Connection Capacity

Configure bounded connection pools for API and worker processes.

Calculate the combined maximum connections across all instances, leaving capacity for migrations, monitoring, administration, and recovery.

If the API or worker scales horizontally, reassess connection limits before increasing replica counts.

### 8.4 High Availability

The initial deployment may use a single PostgreSQL instance if the workload and recovery requirements permit it.

As availability requirements increase, consider managed PostgreSQL, replication, automated failover, and tested recovery procedures.

Replication is not a substitute for backups. Accidental deletion or logical corruption may propagate to replicas.

## 9. Database Migrations

### 9.1 Migration Ownership

Database schema changes must be version-controlled and applied through a dedicated migration command or deployment step.

The API and worker must not independently race to apply migrations during normal startup.

### 9.2 Release Sequence

Use the following general release sequence:

1. Build and test the release artifact.
2. Validate migration scripts against representative databases.
3. Back up the database when the migration risk requires it.
4. Apply backward-compatible migrations.
5. Deploy the API and worker versions compatible with the migrated schema.
6. Verify readiness and critical workflows.
7. Complete data backfills or follow-up schema changes as appropriate.
8. Remove obsolete schema elements only after dependent application versions no longer require them.

### 9.3 Expand-and-Contract

Prefer expand-and-contract migrations for changes that must coexist with old and new application versions.

For example:

- Add a new nullable column.
- Deploy code that can read and write both representations as needed.
- Backfill existing records.
- Switch reads to the new representation.
- Remove the old column in a later release.

Not every migration requires this process, but destructive changes must be reviewed carefully.

### 9.4 Failure Recovery

A failed migration must halt the release and leave the system in a documented state.

Do not assume that every migration can be safely reversed after application writes have occurred.

For irreversible changes, define a forward-recovery plan before deployment. Preserve financial and usage data throughout recovery.

## 10. API and Worker Deployment

### 10.1 API

The API must:

- Validate configuration before serving traffic.
- Expose liveness and readiness checks.
- Stop accepting work during graceful shutdown.
- Use bounded database connection pools.
- Return safe errors when dependencies fail.
- Remain compatible with the current persisted job and data formats.

The deployment platform must route traffic only to ready instances.

### 10.2 Worker

The worker must:

- Validate its configuration and dependencies.
- Use a dedicated runtime command and identity.
- Process durable jobs with bounded concurrency.
- Apply documented timeout and retry policies.
- Stop claiming new jobs during shutdown.
- Preserve idempotency when jobs are retried.
- Expose health and processing metrics.

Deployments must account for jobs created by older application versions. Persisted jobs must not become unprocessable merely because a new release changes an internal payload shape.

### 10.3 Scaling

Scale the API based on measured request volume, latency, and resource utilization.

Scale workers based on queue age, backlog, job duration, and downstream capacity.

Worker concurrency must remain within the capacity of PostgreSQL and external providers. Increasing replicas without adjusting connection pools and provider limits can make the system less reliable.

## 11. Frontend Deployment

Build the React application as static assets.

The production frontend must use the configured public API URL and approved authentication integration.

Deployment must account for browser caching:

- Versioned assets may receive long-lived cache headers.
- The HTML entry point must be revalidated or have an appropriate short cache lifetime.
- Old and new frontend assets must not create inconsistent API assumptions.
- Public configuration must never contain secrets.

The frontend must handle temporary API unavailability, authentication expiration, and expected error responses without displaying misleading billing or payment states.

## 12. CI/CD Pipeline

The deployment pipeline must include:

1. Source validation and formatting.
2. TypeScript compilation and static checks.
3. Backend and frontend unit tests.
4. PostgreSQL integration tests.
5. Tenant-isolation and financial-integrity tests.
6. OpenAPI contract validation.
7. Dependency and container security checks.
8. Container image construction.
9. Release artifact publication.
10. Staging deployment and smoke tests.
11. Production approval or release policy.
12. Production deployment and post-deployment verification.

Build artifacts must be traceable to the source revision and test results that produced them.

Production deployment credentials must be restricted to the deployment process and authorized operators.

## 13. Release Strategy

### 13.1 Initial Strategy

Begin with controlled deployments using Docker Compose or the selected hosting platform.

Deploy the frontend, API, and worker as explicitly versioned components. Keep the release process simple and repeatable.

For a single-instance deployment, a short maintenance window may be acceptable if it is explicitly documented and does not compromise database consistency.

### 13.2 Zero-Downtime Considerations

Zero-downtime deployment is an operational objective, not an unconditional guarantee.

It requires:

- Compatible database migrations.
- Readiness-based traffic routing.
- Graceful process shutdown.
- Compatible API contracts.
- Worker-safe job processing.
- A deployment strategy that supports overlapping versions.

If the hosting platform cannot provide these capabilities, document expected downtime and the safe maintenance procedure.

### 13.3 Release Verification

After deployment, verify:

- API readiness.
- Frontend availability.
- Database connectivity.
- Worker health and job progress.
- Authentication integration.
- Usage ingestion.
- Entitlement evaluation.
- Invoice generation using controlled test data where appropriate.
- Payment-provider integration health.
- Error rates and latency.

Do not initiate real customer charges as a routine smoke test.

## 14. Rollback and Forward Recovery

### 14.1 Application Rollback

Application rollback must restore a previously validated artifact when compatible with the current database schema and persisted job formats.

Before rolling back, verify that the previous version can safely operate against the current schema.

### 14.2 Database Recovery

Database rollback is separate from application rollback.

If a migration has changed or removed persisted data, deploying an older application version may not restore compatibility.

Use the documented forward-recovery procedure or restore strategy when reversing the migration would risk data loss.

### 14.3 Financial Recovery

Never attempt to repair billing inconsistencies by editing issued invoices or payment state without the approved correction process.

After a failed deployment or restoration, reconcile affected payment records and usage processing before resuming the impacted workflows.

## 15. Backup and Disaster Recovery

Production backup procedures must define:

- Backup frequency and retention.
- Encryption and access restrictions.
- Backup storage independent of the primary failure domain where practical.
- Monitoring of backup completion.
- Restoration testing.
- Recovery-point objective (RPO).
- Recovery-time objective (RTO).

Test the complete recovery process, including database restoration, application configuration, required secrets, migrations, and background job recovery.

Following restoration, reconcile internal payment state with the payment provider where necessary. Replay usage and jobs only through documented idempotent procedures.

## 16. Environment-Specific Safety Controls

| Control | Development | Testing | Staging | Production |
|---|---|---|---|---|
| Data | Synthetic or disposable | Isolated fixtures | Synthetic or approved anonymized | Real customer data |
| Credentials | Local credentials | Test credentials | Staging credentials | Protected production secrets |
| Payments | Fake or sandbox | Fake or sandbox | Sandbox by default | Approved live provider |
| Logging | Detailed, sanitized | Test diagnostics | Structured | Structured and access-controlled |
| Database | Disposable permitted | Isolated | Persistent as needed | Persistent and backed up |
| Access | Developer-controlled | CI-controlled | Restricted | Least privilege and audited |
| Deployment | Local | Automated | Automated | Controlled release |

Production configuration must not inherit permissive development defaults.

## 17. Deployment Documentation

Maintain the following operational documentation:

- Environment setup instructions.
- Required configuration variables.
- Secret provisioning and rotation procedures.
- Docker image build instructions.
- Database initialization and migration commands.
- Deployment and release procedures.
- Backup and restoration procedures.
- Health-check endpoints.
- Rollback and forward-recovery procedures.
- Troubleshooting and incident runbooks.

Document actual commands and configuration names in the repository as they are implemented. Examples must be clearly marked as examples and must not contain real credentials.

## 18. Acceptance Criteria

The deployment architecture is ready for implementation when:

- [ ] Frontend, API, and worker have reproducible deployment artifacts.
- [ ] Development, testing, staging, and production are separated.
- [ ] Production secrets are not embedded in source code or frontend assets.
- [ ] PostgreSQL data persists across application container replacement.
- [ ] Database migrations run through a controlled deployment step.
- [ ] API and worker shutdown behavior is safe.
- [ ] Health checks support appropriate readiness and liveness decisions.
- [ ] CI validates critical security, billing, and tenant-isolation behavior.
- [ ] Release artifacts are versioned and traceable.
- [ ] Database compatibility is considered during deployment and rollback.
- [ ] Backups are monitored and restoration is tested.
- [ ] Recovery objectives and incident procedures are documented.
- [ ] Production verification includes usage, billing, and worker health.
- [ ] Payment and usage recovery procedures preserve idempotency and financial integrity.

## 19. Implementation Principles

1. Keep the initial deployment simple and reproducible.
2. Build once and promote the same tested artifacts between environments.
3. Keep application deployment separate from schema migration execution.
4. Treat database compatibility as a release requirement.
5. Assume background jobs may survive application releases and be delivered more than once.
6. Protect secrets and production data at every deployment boundary.
7. Test restoration and recovery rather than relying solely on successful backup jobs.
8. Introduce orchestration and high-availability complexity only when justified by availability, scale, or operational requirements.

This deployment model establishes a practical path from local development to production while preserving tenant isolation, usage correctness, and financial integrity.