import type { MigrationInterface, QueryRunner } from "typeorm";

/** Phase 4: quota policies, atomic usage counters, and reservations. */
export class Quotas1760600000000 implements MigrationInterface {
	name = "Quotas1760600000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE quota_policies (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				subscription_id UUID NOT NULL,
				metric_id UUID NOT NULL,
				limit_value NUMERIC(24,8) NULL,
				unmetered BOOLEAN NOT NULL DEFAULT FALSE,
				window_type TEXT NOT NULL CHECK (
					window_type IN (
						'minute', 'hour', 'day', 'month',
						'billing_period', 'lifetime', 'concurrent'
					)
				),
				window_size INTEGER NULL CHECK (
					window_size IS NULL OR window_size > 0
				),
				enforcement_mode TEXT NOT NULL CHECK (
					enforcement_mode IN ('hard', 'soft', 'rate', 'concurrent', 'observe_only')
				),
				overage_policy TEXT NOT NULL CHECK (
					overage_policy IN ('deny', 'allow', 'charge')
				),
				effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
				effective_until TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_quota_policies_tenant_metric
					UNIQUE (tenant_id, metric_id),
				CONSTRAINT ck_quota_policies_limit
					CHECK (
						(unmetered AND limit_value IS NULL) OR
						(NOT unmetered AND limit_value IS NOT NULL AND limit_value >= 0)
					),
				CONSTRAINT ck_quota_policies_effective
					CHECK (
						effective_until IS NULL OR effective_until > effective_from
					),
				CONSTRAINT fk_quota_policies_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id),
				CONSTRAINT fk_quota_policies_metric
					FOREIGN KEY (tenant_id, metric_id)
					REFERENCES usage_metrics (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_quota_policies_tenant_subscription_metric
				ON quota_policies (tenant_id, subscription_id, metric_id)
		`);

		await queryRunner.query(`
			CREATE TABLE quota_usage_counters (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				subscription_id UUID NOT NULL,
				metric_id UUID NOT NULL,
				period_start TIMESTAMPTZ NOT NULL,
				period_end TIMESTAMPTZ NOT NULL,
				used_value NUMERIC(24,8) NOT NULL DEFAULT 0,
				reserved_value NUMERIC(24,8) NOT NULL DEFAULT 0,
				counter_version INTEGER NOT NULL DEFAULT 1,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_quota_counters_period
					UNIQUE (tenant_id, metric_id, period_start, period_end),
				CONSTRAINT ck_quota_counters_period
					CHECK (period_end > period_start),
				CONSTRAINT ck_quota_counters_values
					CHECK (used_value >= 0 AND reserved_value >= 0),
				CONSTRAINT fk_quota_counters_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id),
				CONSTRAINT fk_quota_counters_metric
					FOREIGN KEY (tenant_id, metric_id)
					REFERENCES usage_metrics (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_quota_counters_tenant_metric_period
				ON quota_usage_counters (tenant_id, metric_id, period_start)
		`);

		await queryRunner.query(`
			CREATE TABLE quota_reservations (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				subscription_id UUID NOT NULL,
				metric_id UUID NOT NULL,
				counter_id UUID NOT NULL,
				operation_id TEXT NOT NULL,
				scope_key TEXT NOT NULL DEFAULT 'tenant',
				window_type TEXT NOT NULL CHECK (
					window_type IN (
						'minute', 'hour', 'day', 'month',
						'billing_period', 'lifetime', 'concurrent'
					)
				),
				reserved_quantity NUMERIC(24,8) NOT NULL,
				committed_quantity NUMERIC(24,8) NOT NULL DEFAULT 0,
				status TEXT NOT NULL DEFAULT 'reserved' CHECK (
					status IN ('reserved', 'committed', 'released', 'expired')
				),
				exceeded BOOLEAN NOT NULL DEFAULT FALSE,
				overrun BOOLEAN NOT NULL DEFAULT FALSE,
				expires_at TIMESTAMPTZ NOT NULL,
				committed_at TIMESTAMPTZ NULL,
				released_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_quota_reservations_operation
					UNIQUE (tenant_id, operation_id),
				CONSTRAINT ck_quota_reservations_quantities
					CHECK (
						reserved_quantity > 0 AND committed_quantity >= 0
					),
				CONSTRAINT fk_quota_reservations_counter
					FOREIGN KEY (counter_id) REFERENCES quota_usage_counters (id),
				CONSTRAINT fk_quota_reservations_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id),
				CONSTRAINT fk_quota_reservations_metric
					FOREIGN KEY (tenant_id, metric_id)
					REFERENCES usage_metrics (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_quota_reservations_tenant_metric_status
				ON quota_reservations (tenant_id, metric_id, status, expires_at)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_quota_reservations_counter
				ON quota_reservations (counter_id)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE quota_reservations");
		await queryRunner.query("DROP TABLE quota_usage_counters");
		await queryRunner.query("DROP TABLE quota_policies");
	}
}
