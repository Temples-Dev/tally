import type { MigrationInterface, QueryRunner } from "typeorm";

/** Phase 5: credit notes, adjustments, billing operations, and reconciliation. */
export class BillingCorrectionsReconciliation1760800000000
	implements MigrationInterface
{
	name = "BillingCorrectionsReconciliation1760800000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check
		`);
		await queryRunner.query(`
			ALTER TABLE invoices
				ADD CONSTRAINT ck_invoices_status CHECK (
					status IN (
						'draft', 'open', 'paid', 'partially_paid',
						'credited', 'void', 'uncollectible'
					)
				)
		`);

		await queryRunner.query(`
			CREATE TABLE credit_notes (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				customer_account_id UUID NOT NULL,
				invoice_id UUID NOT NULL,
				credit_note_number TEXT NOT NULL,
				currency CHAR(3) NOT NULL,
				amount NUMERIC(20,4) NOT NULL CHECK (amount > 0),
				reason TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'issued' CHECK (
					status IN ('issued', 'void')
				),
				issued_at TIMESTAMPTZ NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_credit_notes_number
					UNIQUE (tenant_id, credit_note_number),
				CONSTRAINT uq_credit_notes_tenant_id UNIQUE (tenant_id, id),
				CONSTRAINT fk_credit_notes_customer
					FOREIGN KEY (tenant_id, customer_account_id)
					REFERENCES customer_accounts (tenant_id, id),
				CONSTRAINT fk_credit_notes_invoice
					FOREIGN KEY (tenant_id, invoice_id)
					REFERENCES invoices (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_credit_notes_tenant_invoice_created
				ON credit_notes (tenant_id, invoice_id, created_at)
		`);

		await queryRunner.query(`
			CREATE TABLE credit_note_lines (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				credit_note_id UUID NOT NULL,
				line_number INTEGER NOT NULL CHECK (line_number > 0),
				invoice_line_id UUID NULL,
				description TEXT NOT NULL,
				amount NUMERIC(20,4) NOT NULL CHECK (amount > 0),
				metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_credit_note_lines_number
					UNIQUE (tenant_id, credit_note_id, line_number),
				CONSTRAINT fk_credit_note_lines_note
					FOREIGN KEY (tenant_id, credit_note_id)
					REFERENCES credit_notes (tenant_id, id) ON DELETE CASCADE,
				CONSTRAINT fk_credit_note_lines_invoice_line
					FOREIGN KEY (invoice_line_id)
					REFERENCES invoice_line_items (id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_credit_note_lines_note
				ON credit_note_lines (tenant_id, credit_note_id)
		`);

		await queryRunner.query(`
			CREATE TABLE credit_note_number_sequences (
				tenant_id UUID PRIMARY KEY,
				next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT fk_credit_note_number_sequences_tenant
					FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
			)
		`);

		await queryRunner.query(`
			CREATE TABLE billing_adjustments (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				customer_account_id UUID NOT NULL,
				subscription_id UUID NULL,
				invoice_id UUID NULL,
				adjustment_type TEXT NOT NULL CHECK (
					adjustment_type IN ('credit', 'debit')
				),
				amount NUMERIC(20,4) NOT NULL CHECK (amount > 0),
				currency CHAR(3) NOT NULL,
				reason TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending' CHECK (
					status IN ('pending', 'applied', 'void')
				),
				idempotency_key TEXT NOT NULL,
				created_by TEXT NULL,
				applied_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_billing_adjustments_idempotency
					UNIQUE (tenant_id, idempotency_key),
				CONSTRAINT fk_billing_adjustments_customer
					FOREIGN KEY (tenant_id, customer_account_id)
					REFERENCES customer_accounts (tenant_id, id),
				CONSTRAINT fk_billing_adjustments_subscription
					FOREIGN KEY (tenant_id, subscription_id)
					REFERENCES subscriptions (tenant_id, id),
				CONSTRAINT fk_billing_adjustments_invoice
					FOREIGN KEY (tenant_id, invoice_id)
					REFERENCES invoices (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_billing_adjustments_tenant_customer_status
				ON billing_adjustments (tenant_id, customer_account_id, status, created_at)
		`);

		await queryRunner.query(`
			CREATE TABLE billing_operations (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				operation_type TEXT NOT NULL,
				source_type TEXT NOT NULL,
				source_id UUID NULL,
				idempotency_key TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending' CHECK (
					status IN ('pending', 'running', 'completed', 'failed')
				),
				attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
				last_error_code TEXT NULL,
				invoice_id UUID NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_billing_operations_idempotency
					UNIQUE (tenant_id, idempotency_key),
				CONSTRAINT fk_billing_operations_invoice
					FOREIGN KEY (tenant_id, invoice_id)
					REFERENCES invoices (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_billing_operations_tenant_status_created
				ON billing_operations (tenant_id, status, created_at)
		`);

		await queryRunner.query(`
			CREATE TABLE billing_reconciliation_runs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				status TEXT NOT NULL DEFAULT 'running' CHECK (
					status IN ('running', 'completed', 'failed')
				),
				requested_by TEXT NULL,
				invoices_checked INTEGER NOT NULL DEFAULT 0,
				discrepancies_found INTEGER NOT NULL DEFAULT 0,
				error_code TEXT NULL,
				started_at TIMESTAMPTZ NOT NULL,
				completed_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT fk_billing_reconciliation_runs_tenant
					FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_billing_reconciliation_runs_tenant_created
				ON billing_reconciliation_runs (tenant_id, created_at)
		`);

		await queryRunner.query(`
			CREATE TABLE billing_discrepancies (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				reconciliation_run_id UUID NOT NULL,
				category TEXT NOT NULL CHECK (
					category IN (
						'INVOICE_TOTAL_MISMATCH', 'LINE_TOTAL_MISMATCH',
						'CURRENCY_MISMATCH', 'AMOUNT_DUE_MISMATCH',
						'DUPLICATE_INVOICE', 'MISSING_INVOICE',
						'BILLING_CALCULATION_MISMATCH',
						'CREDIT_TOTAL_MISMATCH', 'USAGE_MISMATCH'
					)
				),
				resource_type TEXT NOT NULL,
				resource_id UUID NULL,
				details JSONB NOT NULL DEFAULT '{}'::jsonb,
				status TEXT NOT NULL DEFAULT 'open' CHECK (
					status IN ('open', 'resolved', 'ignored')
				),
				resolution_note TEXT NULL,
				resolved_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT fk_billing_discrepancies_run
					FOREIGN KEY (reconciliation_run_id)
					REFERENCES billing_reconciliation_runs (id) ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_billing_discrepancies_tenant_status_created
				ON billing_discrepancies (tenant_id, status, created_at)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_billing_discrepancies_tenant_run_category
				ON billing_discrepancies (tenant_id, reconciliation_run_id, category)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE billing_discrepancies");
		await queryRunner.query("DROP TABLE billing_reconciliation_runs");
		await queryRunner.query("DROP TABLE billing_operations");
		await queryRunner.query("DROP TABLE billing_adjustments");
		await queryRunner.query("DROP TABLE credit_note_number_sequences");
		await queryRunner.query("DROP TABLE credit_note_lines");
		await queryRunner.query("DROP TABLE credit_notes");
		await queryRunner.query(
			"ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_status",
		);
		await queryRunner.query(`
			ALTER TABLE invoices
				ADD CONSTRAINT ck_invoices_status CHECK (
					status IN (
						'draft', 'open', 'paid', 'partially_paid',
						'void', 'uncollectible'
					)
				)
		`);
	}
}
