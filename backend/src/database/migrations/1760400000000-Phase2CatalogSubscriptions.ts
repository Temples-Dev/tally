import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 2: catalog (products, plans, versions, meters, entitlement
 * definitions), subscriptions (customers, subscriptions, changes,
 * overrides). Tenant-scoped composite foreign keys throughout.
 */
export class Phase2CatalogSubscriptions1760400000000
	implements MigrationInterface
{
	name = "Phase2CatalogSubscriptions1760400000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE products (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				code TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT NULL,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_products_tenant_code UNIQUE (tenant_id, code),
				CONSTRAINT uq_products_tenant_id UNIQUE (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE TABLE plans (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				product_id UUID NOT NULL,
				code TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT NULL,
				status TEXT NOT NULL DEFAULT 'draft',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_plans_tenant_product_code UNIQUE (tenant_id, product_id, code),
				CONSTRAINT uq_plans_tenant_id UNIQUE (tenant_id, id),
				CONSTRAINT fk_plans_product FOREIGN KEY (tenant_id, product_id)
					REFERENCES products (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE TABLE plan_versions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				plan_id UUID NOT NULL,
				version_number INTEGER NOT NULL CHECK (version_number > 0),
				effective_from TIMESTAMPTZ NOT NULL,
				effective_until TIMESTAMPTZ NULL CHECK (effective_until IS NULL OR effective_until > effective_from),
				configuration JSONB NOT NULL DEFAULT '{}',
				status TEXT NOT NULL DEFAULT 'draft',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				published_at TIMESTAMPTZ NULL,
				CONSTRAINT uq_plan_versions_number UNIQUE (tenant_id, plan_id, version_number),
				CONSTRAINT uq_plan_versions_tenant_id UNIQUE (tenant_id, id),
				CONSTRAINT fk_plan_versions_plan FOREIGN KEY (tenant_id, plan_id)
					REFERENCES plans (tenant_id, id) ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`
			CREATE TABLE usage_metrics (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				code TEXT NOT NULL,
				name TEXT NOT NULL,
				unit TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_usage_metrics_tenant_code UNIQUE (tenant_id, code)
			)
		`);
		await queryRunner.query(`
			CREATE TABLE entitlement_definitions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				code TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT NULL,
				value_type TEXT NOT NULL,
				default_value JSONB NULL,
				validation_schema JSONB NULL,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_entitlement_definitions_tenant_code UNIQUE (tenant_id, code),
				CONSTRAINT uq_entitlement_definitions_tenant_id UNIQUE (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE TABLE plan_entitlements (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				plan_version_id UUID NOT NULL,
				entitlement_definition_id UUID NOT NULL,
				value JSONB NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_plan_entitlements UNIQUE (tenant_id, plan_version_id, entitlement_definition_id),
				CONSTRAINT fk_plan_entitlements_version FOREIGN KEY (tenant_id, plan_version_id)
					REFERENCES plan_versions (tenant_id, id) ON DELETE CASCADE,
				CONSTRAINT fk_plan_entitlements_definition FOREIGN KEY (tenant_id, entitlement_definition_id)
					REFERENCES entitlement_definitions (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE TABLE customer_accounts (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				external_customer_ref TEXT NULL,
				display_name TEXT NOT NULL,
				email TEXT NULL,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_customer_accounts_tenant_id UNIQUE (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE UNIQUE INDEX uq_customer_accounts_external_ref
				ON customer_accounts (tenant_id, external_customer_ref)
				WHERE external_customer_ref IS NOT NULL
		`);
		await queryRunner.query(`
			CREATE INDEX ix_customer_accounts_tenant_status_created
				ON customer_accounts (tenant_id, status, created_at DESC)
		`);
		await queryRunner.query(`
			CREATE TABLE subscriptions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				customer_account_id UUID NOT NULL,
				product_id UUID NOT NULL,
				plan_version_id UUID NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending',
				started_at TIMESTAMPTZ NULL,
				current_period_start TIMESTAMPTZ NULL,
				current_period_end TIMESTAMPTZ NULL,
				trial_ends_at TIMESTAMPTZ NULL,
				cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
				cancelled_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_subscriptions_tenant_id UNIQUE (tenant_id, id),
				CONSTRAINT fk_subscriptions_customer FOREIGN KEY (tenant_id, customer_account_id)
					REFERENCES customer_accounts (tenant_id, id),
				CONSTRAINT fk_subscriptions_product FOREIGN KEY (tenant_id, product_id)
					REFERENCES products (tenant_id, id),
				CONSTRAINT fk_subscriptions_version FOREIGN KEY (tenant_id, plan_version_id)
					REFERENCES plan_versions (tenant_id, id),
				CONSTRAINT chk_subscription_periods CHECK (
					current_period_end IS NULL OR current_period_start IS NULL
					OR current_period_end > current_period_start
				)
			)
		`);
		await queryRunner.query(`
			CREATE UNIQUE INDEX uq_subscriptions_active_per_product
				ON subscriptions (tenant_id, product_id)
				WHERE status IN ('active', 'trialing')
		`);
		await queryRunner.query(`
			CREATE INDEX ix_subscriptions_tenant_customer_status
				ON subscriptions (tenant_id, customer_account_id, status)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_subscriptions_tenant_status_period_end
				ON subscriptions (tenant_id, status, current_period_end)
		`);
		await queryRunner.query(`
			CREATE TABLE subscription_changes (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				subscription_id UUID NOT NULL,
				change_type TEXT NOT NULL,
				effective_at TIMESTAMPTZ NOT NULL,
				previous_configuration JSONB NOT NULL,
				new_configuration JSONB NOT NULL,
				status TEXT NOT NULL DEFAULT 'applied',
				applied_at TIMESTAMPTZ NULL,
				actor_id TEXT NULL,
				reason TEXT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT fk_subscription_changes_subscription FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id) ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_subscription_changes_tenant_subscription_effective
				ON subscription_changes (tenant_id, subscription_id, effective_at DESC)
		`);
		await queryRunner.query(`
			CREATE TABLE entitlement_overrides (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				subscription_id UUID NOT NULL,
				entitlement_definition_id UUID NOT NULL,
				value JSONB NOT NULL,
				reason TEXT NOT NULL,
				effective_from TIMESTAMPTZ NOT NULL,
				effective_until TIMESTAMPTZ NULL,
				created_by TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT fk_entitlement_overrides_subscription FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id) ON DELETE CASCADE,
				CONSTRAINT fk_entitlement_overrides_definition FOREIGN KEY (tenant_id, entitlement_definition_id)
					REFERENCES entitlement_definitions (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_entitlement_overrides_lookup
				ON entitlement_overrides (tenant_id, subscription_id, effective_from, effective_until)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE entitlement_overrides");
		await queryRunner.query("DROP TABLE subscription_changes");
		await queryRunner.query("DROP TABLE subscriptions");
		await queryRunner.query("DROP TABLE customer_accounts");
		await queryRunner.query("DROP TABLE plan_entitlements");
		await queryRunner.query("DROP TABLE entitlement_definitions");
		await queryRunner.query("DROP TABLE usage_metrics");
		await queryRunner.query("DROP TABLE plan_versions");
		await queryRunner.query("DROP TABLE plans");
		await queryRunner.query("DROP TABLE products");
	}
}
