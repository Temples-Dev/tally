import type { MigrationInterface, QueryRunner } from "typeorm";

/** Phase 3 foundation: durable, retryable background jobs. */
export class BackgroundJobs1760500000000 implements MigrationInterface {
	name = "BackgroundJobs1760500000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE background_jobs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NULL,
				job_type TEXT NOT NULL,
				idempotency_key TEXT NOT NULL,
				payload JSONB NOT NULL DEFAULT '{}',
				status TEXT NOT NULL DEFAULT 'pending' CHECK (
					status IN ('pending', 'running', 'succeeded', 'failed', 'dead')
				),
				attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
				max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
				available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				locked_at TIMESTAMPTZ NULL,
				locked_by TEXT NULL,
				last_error_code TEXT NULL,
				last_error TEXT NULL,
				completed_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_background_jobs_type_key UNIQUE (job_type, idempotency_key)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_background_jobs_status_available
				ON background_jobs (status, available_at)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_background_jobs_locked_at
				ON background_jobs (locked_at)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_background_jobs_tenant_created
				ON background_jobs (tenant_id, created_at DESC)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE background_jobs");
	}
}
