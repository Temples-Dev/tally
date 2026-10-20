import type { MigrationInterface, QueryRunner } from "typeorm";

/** Phase 6: Paystack payment attempts, transactions, and webhook events. */
export class PaymentsPaystack1760900000000 implements MigrationInterface {
	name = "PaymentsPaystack1760900000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE payment_provider_accounts (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				provider_code TEXT NOT NULL CHECK (provider_code IN ('paystack')),
				external_account_reference TEXT NULL,
				status TEXT NOT NULL DEFAULT 'active' CHECK (
					status IN ('active', 'disabled')
				),
				encrypted_secret_key TEXT NOT NULL,
				secret_key_iv TEXT NOT NULL,
				secret_key_tag TEXT NOT NULL,
				secret_key_last4 CHAR(4) NOT NULL,
				public_key TEXT NULL,
				default_callback_url TEXT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_payment_provider_accounts_tenant_provider
					UNIQUE (tenant_id, provider_code),
				CONSTRAINT uq_payment_provider_accounts_tenant_id
					UNIQUE (tenant_id, id),
				CONSTRAINT fk_payment_provider_accounts_tenant
					FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_payment_provider_accounts_tenant_status
				ON payment_provider_accounts (tenant_id, status)
		`);

		await queryRunner.query(`
			CREATE TABLE payment_attempts (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				invoice_id UUID NOT NULL,
				provider_account_id UUID NOT NULL,
				idempotency_key TEXT NOT NULL,
				amount NUMERIC(20,4) NOT NULL CHECK (amount > 0),
				currency CHAR(3) NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending' CHECK (
					status IN (
						'pending', 'processing', 'requires_action',
						'succeeded', 'failed', 'cancelled'
					)
				),
				provider_reference TEXT NOT NULL,
				checkout_url TEXT NULL,
				failure_code TEXT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				completed_at TIMESTAMPTZ NULL,
				CONSTRAINT uq_payment_attempts_idempotency
					UNIQUE (tenant_id, provider_account_id, idempotency_key),
				CONSTRAINT uq_payment_attempts_provider_reference
					UNIQUE (provider_reference),
				CONSTRAINT uq_payment_attempts_tenant_id UNIQUE (tenant_id, id),
				CONSTRAINT fk_payment_attempts_invoice
					FOREIGN KEY (tenant_id, invoice_id)
					REFERENCES invoices (tenant_id, id),
				CONSTRAINT fk_payment_attempts_provider_account
					FOREIGN KEY (tenant_id, provider_account_id)
					REFERENCES payment_provider_accounts (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_payment_attempts_tenant_invoice_created
				ON payment_attempts (tenant_id, invoice_id, created_at DESC)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_payment_attempts_tenant_status_created
				ON payment_attempts (tenant_id, status, created_at)
		`);

		await queryRunner.query(`
			CREATE TABLE payment_transactions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				invoice_id UUID NOT NULL,
				provider_account_id UUID NOT NULL,
				payment_attempt_id UUID NULL,
				provider_transaction_reference TEXT NOT NULL,
				transaction_type TEXT NOT NULL CHECK (
					transaction_type IN ('payment', 'refund', 'reversal')
				),
				amount NUMERIC(20,4) NOT NULL,
				currency CHAR(3) NOT NULL,
				status TEXT NOT NULL CHECK (
					status IN ('succeeded', 'failed')
				),
				occurred_at TIMESTAMPTZ NULL,
				metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
				recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_payment_transactions_provider_reference
					UNIQUE (
						provider_account_id, provider_transaction_reference,
						transaction_type
					),
				CONSTRAINT fk_payment_transactions_invoice
					FOREIGN KEY (tenant_id, invoice_id)
					REFERENCES invoices (tenant_id, id),
				CONSTRAINT fk_payment_transactions_provider_account
					FOREIGN KEY (tenant_id, provider_account_id)
					REFERENCES payment_provider_accounts (tenant_id, id),
				CONSTRAINT fk_payment_transactions_attempt
					FOREIGN KEY (tenant_id, payment_attempt_id)
					REFERENCES payment_attempts (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_payment_transactions_tenant_invoice_recorded
				ON payment_transactions (tenant_id, invoice_id, recorded_at)
		`);

		await queryRunner.query(`
			CREATE TABLE payment_webhook_events (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL,
				provider_account_id UUID NOT NULL,
				provider_event_id TEXT NOT NULL,
				event_type TEXT NOT NULL,
				verification_status TEXT NOT NULL CHECK (
					verification_status IN ('verified')
				),
				processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (
					processing_status IN ('pending', 'processed', 'failed', 'ignored')
				),
				payload JSONB NOT NULL,
				payload_hash TEXT NOT NULL,
				error_code TEXT NULL,
				received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				processed_at TIMESTAMPTZ NULL,
				CONSTRAINT uq_payment_webhook_events_provider_event
					UNIQUE (tenant_id, provider_account_id, provider_event_id),
				CONSTRAINT fk_payment_webhook_events_provider_account
					FOREIGN KEY (tenant_id, provider_account_id)
					REFERENCES payment_provider_accounts (tenant_id, id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_payment_webhook_events_tenant_status_received
				ON payment_webhook_events (tenant_id, processing_status, received_at)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE payment_webhook_events");
		await queryRunner.query("DROP TABLE payment_transactions");
		await queryRunner.query("DROP TABLE payment_attempts");
		await queryRunner.query("DROP TABLE payment_provider_accounts");
	}
}
