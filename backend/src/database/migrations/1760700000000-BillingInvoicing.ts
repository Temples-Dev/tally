import type { MigrationInterface, QueryRunner } from "typeorm";

/** Phase 5: prices, subscription items, billing periods, and invoices. */
export class BillingInvoicing1760700000000 implements MigrationInterface {
	name = "BillingInvoicing1760700000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE prices (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				plan_id UUID NOT NULL,
				price_code TEXT NOT NULL,
				version_number INTEGER NOT NULL CHECK (version_number > 0),
				currency CHAR(3) NOT NULL,
				billing_interval TEXT NOT NULL CHECK (
					billing_interval IN ('month', 'year')
				),
				pricing_model TEXT NOT NULL CHECK (
					pricing_model IN ('flat', 'per_unit', 'metered')
				),
				effective_from TIMESTAMPTZ NOT NULL,
				effective_until TIMESTAMPTZ NULL,
				configuration JSONB NOT NULL,
				status TEXT NOT NULL DEFAULT 'active' CHECK (
					status IN ('active', 'archived')
				),
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_prices_version
					UNIQUE (tenant_id, plan_id, price_code, version_number),
				CONSTRAINT uq_prices_tenant_id UNIQUE (tenant_id, id),
				CONSTRAINT ck_prices_effective
					CHECK (effective_until IS NULL OR effective_until > effective_from),
				CONSTRAINT fk_prices_plan
					FOREIGN KEY (tenant_id, plan_id)
					REFERENCES plans (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_prices_tenant_plan_code
				ON prices (tenant_id, plan_id, price_code)
		`);

		await queryRunner.query(`
			CREATE TABLE subscription_items (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				subscription_id UUID NOT NULL,
				price_id UUID NOT NULL,
				quantity NUMERIC(24,8) NOT NULL DEFAULT 1 CHECK (quantity > 0),
				description TEXT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_subscription_items_price
					UNIQUE (tenant_id, subscription_id, price_id),
				CONSTRAINT fk_subscription_items_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id) ON DELETE CASCADE,
				CONSTRAINT fk_subscription_items_price
					FOREIGN KEY (tenant_id, price_id)
					REFERENCES prices (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_subscription_items_tenant_subscription
				ON subscription_items (tenant_id, subscription_id)
		`);

		await queryRunner.query(`
			CREATE TABLE billing_periods (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				subscription_id UUID NOT NULL,
				period_start TIMESTAMPTZ NOT NULL,
				period_end TIMESTAMPTZ NOT NULL,
				status TEXT NOT NULL DEFAULT 'open' CHECK (
					status IN ('open', 'invoiced', 'closed')
				),
				calculation_version INTEGER NOT NULL DEFAULT 1 CHECK (
					calculation_version > 0
				),
				completed_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_billing_periods_window
					UNIQUE (tenant_id, subscription_id, period_start, period_end),
				CONSTRAINT uq_billing_periods_tenant_id UNIQUE (tenant_id, id),
				CONSTRAINT ck_billing_periods_window
					CHECK (period_end > period_start),
				CONSTRAINT fk_billing_periods_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_billing_periods_tenant_subscription
				ON billing_periods (tenant_id, subscription_id, period_start)
		`);

		await queryRunner.query(`
			CREATE TABLE billing_calculations (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				subscription_id UUID NOT NULL,
				billing_period_id UUID NOT NULL,
				pricing_version_reference JSONB NOT NULL,
				usage_snapshot_reference JSONB NOT NULL,
				currency CHAR(3) NOT NULL,
				subtotal NUMERIC(20,4) NOT NULL,
				discount_total NUMERIC(20,4) NOT NULL DEFAULT 0,
				tax_total NUMERIC(20,4) NOT NULL DEFAULT 0,
				total NUMERIC(20,4) NOT NULL,
				calculation_version INTEGER NOT NULL CHECK (calculation_version > 0),
				status TEXT NOT NULL DEFAULT 'completed' CHECK (
					status IN ('completed', 'superseded')
				),
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_billing_calculations_version
					UNIQUE (tenant_id, billing_period_id, calculation_version),
				CONSTRAINT fk_billing_calculations_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id),
				CONSTRAINT fk_billing_calculations_period
					FOREIGN KEY (tenant_id, billing_period_id)
					REFERENCES billing_periods (tenant_id, id)
			)
		`);

		await queryRunner.query(`
			CREATE TABLE invoices (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				customer_account_id UUID NOT NULL,
				billing_period_id UUID NULL,
				invoice_number TEXT NOT NULL,
				billing_profile_snapshot JSONB NOT NULL,
				currency CHAR(3) NOT NULL,
				status TEXT NOT NULL DEFAULT 'draft' CHECK (
					status IN (
						'draft', 'open', 'paid', 'partially_paid',
						'void', 'uncollectible'
					)
				),
				issued_at TIMESTAMPTZ NULL,
				due_at TIMESTAMPTZ NULL,
				period_start TIMESTAMPTZ NULL,
				period_end TIMESTAMPTZ NULL,
				subtotal NUMERIC(20,4) NOT NULL,
				discount_total NUMERIC(20,4) NOT NULL DEFAULT 0,
				tax_total NUMERIC(20,4) NOT NULL DEFAULT 0,
				total NUMERIC(20,4) NOT NULL,
				amount_paid NUMERIC(20,4) NOT NULL DEFAULT 0,
				amount_credited NUMERIC(20,4) NOT NULL DEFAULT 0,
				amount_due NUMERIC(20,4) NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_invoices_number UNIQUE (tenant_id, invoice_number),
				CONSTRAINT uq_invoices_tenant_id UNIQUE (tenant_id, id),
				CONSTRAINT ck_invoices_due
					CHECK (due_at IS NULL OR issued_at IS NULL OR due_at >= issued_at),
				CONSTRAINT fk_invoices_customer
					FOREIGN KEY (tenant_id, customer_account_id)
					REFERENCES customer_accounts (tenant_id, id),
				CONSTRAINT fk_invoices_billing_period
					FOREIGN KEY (tenant_id, billing_period_id)
					REFERENCES billing_periods (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE UNIQUE INDEX uq_invoices_billing_period
				ON invoices (tenant_id, billing_period_id)
				WHERE billing_period_id IS NOT NULL
		`);
		await queryRunner.query(`
			CREATE INDEX ix_invoices_tenant_customer_created
				ON invoices (tenant_id, customer_account_id, created_at)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_invoices_tenant_status_due
				ON invoices (tenant_id, status, due_at)
		`);

		await queryRunner.query(`
			CREATE TABLE invoice_line_items (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				invoice_id UUID NOT NULL,
				line_number INTEGER NOT NULL CHECK (line_number > 0),
				line_type TEXT NOT NULL CHECK (
					line_type IN ('flat', 'per_unit', 'metered', 'adjustment', 'credit')
				),
				description TEXT NOT NULL,
				quantity NUMERIC(24,8) NOT NULL,
				unit_price NUMERIC(20,8) NOT NULL,
				amount NUMERIC(20,4) NOT NULL,
				currency CHAR(3) NOT NULL,
				source_type TEXT NULL,
				source_id UUID NULL,
				price_id UUID NULL,
				metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_invoice_line_items_number
					UNIQUE (tenant_id, invoice_id, line_number),
				CONSTRAINT fk_invoice_line_items_invoice
					FOREIGN KEY (tenant_id, invoice_id)
					REFERENCES invoices (tenant_id, id) ON DELETE CASCADE,
				CONSTRAINT fk_invoice_line_items_price
					FOREIGN KEY (tenant_id, price_id)
					REFERENCES prices (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_invoice_line_items_invoice
				ON invoice_line_items (tenant_id, invoice_id)
		`);

		await queryRunner.query(`
			CREATE TABLE invoice_number_sequences (
				tenant_id UUID PRIMARY KEY,
				next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT fk_invoice_number_sequences_tenant
					FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
			)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE invoice_number_sequences");
		await queryRunner.query("DROP TABLE invoice_line_items");
		await queryRunner.query("DROP TABLE invoices");
		await queryRunner.query("DROP TABLE billing_calculations");
		await queryRunner.query("DROP TABLE billing_periods");
		await queryRunner.query("DROP TABLE subscription_items");
		await queryRunner.query("DROP TABLE prices");
	}
}
