import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager, Repository } from "typeorm";

import { BackgroundJob } from "./entities/background-job.entity";
import { BackgroundJobStatus } from "./enums";

export interface EnqueueJobInput {
	tenantId?: string | null;
	jobType: string;
	idempotencyKey: string;
	payload?: Record<string, unknown>;
	availableAt?: Date;
	maxAttempts?: number;
}

@Injectable()
export class BackgroundJobsService {
	constructor(
		@InjectRepository(BackgroundJob)
		private readonly jobs: Repository<BackgroundJob>,
	) {}

	/**
	 * Durably enqueues a job. Pass the transaction manager when the job must be
	 * committed atomically with the business write that produced it. Enqueuing
	 * the same job type and idempotency key again returns the existing job.
	 */
	async enqueue(
		input: EnqueueJobInput,
		manager?: EntityManager,
	): Promise<BackgroundJob> {
		const repository = manager
			? manager.getRepository(BackgroundJob)
			: this.jobs;
		await repository.query(
			`
			INSERT INTO background_jobs (
				tenant_id,
				job_type,
				idempotency_key,
				payload,
				status,
				available_at,
				max_attempts
			)
			VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
			ON CONFLICT (job_type, idempotency_key) DO NOTHING
			`,
			[
				input.tenantId ?? null,
				input.jobType,
				input.idempotencyKey,
				JSON.stringify(input.payload ?? {}),
				BackgroundJobStatus.PENDING,
				input.availableAt ?? new Date(),
				input.maxAttempts ?? 5,
			],
		);
		const job = await repository.findOneBy({
			jobType: input.jobType,
			idempotencyKey: input.idempotencyKey,
		});
		if (job === null) {
			throw new Error("The job could not be enqueued.");
		}
		return job;
	}

	countByStatus(status: BackgroundJobStatus): Promise<number> {
		return this.jobs.countBy({ status });
	}
}
