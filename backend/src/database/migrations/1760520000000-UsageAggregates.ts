import type { MigrationInterface, QueryRunner } from "typeorm";

/** Phase 3: derived, revisioned daily usage aggregates. */
export class UsageAggregates1760520000000 implements MigrationInterface {
	name = "UsageAggregates1760520000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE usage_aggregates (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				customer_account_id UUID NOT NULL,
				subscription_id UUID NULL,
				metric_id UUID NOT NULL,
				period_start TIMESTAMPTZ NOT NULL,
				period_end TIMESTAMPTZ NOT NULL,
				dimensions JSONB NOT NULL DEFAULT '{}',
				scope_key TEXT NOT NULL,
				aggregation_method TEXT NOT NULL CHECK (
					aggregation_method IN ('sum', 'count', 'max', 'last')
				),
				value NUMERIC(24,8) NOT NULL,
				event_count BIGINT NOT NULL CHECK (event_count >= 0),
				latest_occurred_at TIMESTAMPTZ NULL,
				latest_event_id UUID NULL,
				revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
				calculated_at TIMESTAMPTZ NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_usage_aggregates_scope
					UNIQUE (tenant_id, period_start, period_end, scope_key),
				CONSTRAINT ck_usage_aggregates_period
					CHECK (period_end > period_start),
				CONSTRAINT fk_usage_aggregates_customer
					FOREIGN KEY (tenant_id, customer_account_id)
					REFERENCES customer_accounts (tenant_id, id),
				CONSTRAINT fk_usage_aggregates_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id),
				CONSTRAINT fk_usage_aggregates_metric
					FOREIGN KEY (tenant_id, metric_id)
					REFERENCES usage_metrics (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_usage_aggregates_tenant_metric_period
				ON usage_aggregates (tenant_id, metric_id, period_start, period_end)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_usage_aggregates_tenant_customer_period
				ON usage_aggregates (tenant_id, customer_account_id, period_start)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE usage_aggregates");
	}
}
