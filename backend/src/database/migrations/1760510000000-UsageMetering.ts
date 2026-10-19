import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 3: usage event ingestion. Adds metric aggregation/event-time policy
 * fields and the idempotent usage event store.
 */
export class UsageMetering1760510000000 implements MigrationInterface {
	name = "UsageMetering1760510000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE usage_metrics
				ADD COLUMN aggregation_method TEXT NOT NULL DEFAULT 'sum'
					CHECK (aggregation_method IN ('sum', 'count', 'max', 'last')),
				ADD COLUMN allows_negative BOOLEAN NOT NULL DEFAULT FALSE,
				ADD COLUMN max_event_age_seconds INTEGER NULL
					CHECK (max_event_age_seconds IS NULL OR max_event_age_seconds >= 0),
				ADD COLUMN max_future_skew_seconds INTEGER NOT NULL DEFAULT 300
					CHECK (max_future_skew_seconds >= 0),
				ADD COLUMN allowed_dimensions JSONB NULL,
				ADD CONSTRAINT uq_usage_metrics_tenant_id UNIQUE (tenant_id, id)
		`);
		await queryRunner.query(`
			CREATE TABLE usage_events (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				source TEXT NOT NULL,
				external_event_id TEXT NOT NULL,
				customer_account_id UUID NOT NULL,
				subscription_id UUID NULL,
				metric_id UUID NOT NULL,
				quantity NUMERIC(24,8) NOT NULL,
				dimensions JSONB NOT NULL DEFAULT '{}',
				occurred_at TIMESTAMPTZ NOT NULL,
				received_at TIMESTAMPTZ NOT NULL,
				payload_hash TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'accepted' CHECK (
					status IN ('accepted', 'rejected', 'quarantined')
				),
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_usage_events_dedup
					UNIQUE (tenant_id, source, external_event_id),
				CONSTRAINT fk_usage_events_customer
					FOREIGN KEY (tenant_id, customer_account_id)
					REFERENCES customer_accounts (tenant_id, id),
				CONSTRAINT fk_usage_events_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id),
				CONSTRAINT fk_usage_events_metric
					FOREIGN KEY (tenant_id, metric_id)
					REFERENCES usage_metrics (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_usage_events_tenant_metric_occurred
				ON usage_events (tenant_id, metric_id, occurred_at DESC)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_usage_events_tenant_customer_occurred
				ON usage_events (tenant_id, customer_account_id, occurred_at DESC)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_usage_events_tenant_subscription_occurred
				ON usage_events (tenant_id, subscription_id, occurred_at DESC)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE usage_events");
		await queryRunner.query(`
			ALTER TABLE usage_metrics
				DROP CONSTRAINT uq_usage_metrics_tenant_id,
				DROP COLUMN allowed_dimensions,
				DROP COLUMN max_future_skew_seconds,
				DROP COLUMN max_event_age_seconds,
				DROP COLUMN allows_negative,
				DROP COLUMN aggregation_method
		`);
	}
}
