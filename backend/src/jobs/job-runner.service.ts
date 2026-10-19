import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import {
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
// biome-ignore lint/style/useImportType: ConfigService must be a value import for decorator metadata.
import { ConfigService } from "@nestjs/config";
import { InjectDataSource } from "@nestjs/typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

import type { EnvironmentVariables } from "../config/environment.validation";
import type { BackgroundJob } from "./entities/background-job.entity";
import { JobError } from "./job-handler";
// biome-ignore lint/style/useImportType: JobRegistry must be a value import for decorator metadata.
import { JobRegistry } from "./job-registry.service";

const REAP_INTERVAL_MS = 30_000;
const MAX_BACKOFF_SECONDS = 300;

interface JobRow {
	id: string;
	tenant_id: string | null;
	job_type: string;
	payload: Record<string, unknown>;
	attempt_count: number;
	max_attempts: number;
}

@Injectable()
export class JobRunnerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(JobRunnerService.name);
	private readonly instanceId =
		`${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
	private readonly pollIntervalMs: number;
	private readonly lockTimeoutMs: number;
	private timer?: NodeJS.Timeout;
	private active?: Promise<void>;
	private stopped = false;
	private lastReapAt = 0;

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		configService: ConfigService<EnvironmentVariables>,
		private readonly registry: JobRegistry,
	) {
		this.pollIntervalMs = configService.get<number>(
			"JOB_POLL_INTERVAL_MS",
			1000,
		);
		this.lockTimeoutMs = configService.get<number>(
			"JOB_LOCK_TIMEOUT_MS",
			300_000,
		);
	}

	onModuleInit(): void {
		this.stopped = false;
		this.schedule(0);
		this.logger.log(
			`Job runner ${this.instanceId} polling every ${this.pollIntervalMs}ms`,
		);
	}

	async onModuleDestroy(): Promise<void> {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
		}
		await this.active;
	}

	private schedule(delayMs: number): void {
		if (this.stopped) {
			return;
		}
		this.timer = setTimeout(() => {
			this.active = this.tick();
		}, delayMs);
	}

	private async tick(): Promise<void> {
		try {
			await this.reapExpiredLocksIfDue();
			const job = await this.claimNext();
			if (job !== null) {
				await this.execute(job);
			}
		} catch (error) {
			this.logger.error(
				`Job runner tick failed: ${this.describe(error)}`,
				error instanceof Error ? error.stack : undefined,
			);
		} finally {
			this.schedule(this.pollIntervalMs);
		}
	}

	private async reapExpiredLocksIfDue(): Promise<void> {
		const now = Date.now();
		if (now - this.lastReapAt < REAP_INTERVAL_MS) {
			return;
		}
		this.lastReapAt = now;
		await this.dataSource.query(
			`
			UPDATE background_jobs
			SET status = CASE
					WHEN attempt_count >= max_attempts THEN 'dead'
					ELSE 'failed'
				END,
				available_at = now(),
				locked_at = NULL,
				locked_by = NULL,
				last_error_code = COALESCE(last_error_code, 'LOCK_EXPIRED'),
				last_error = COALESCE(last_error, 'Lock expired before completion.'),
				completed_at = CASE
					WHEN attempt_count >= max_attempts THEN now()
					ELSE completed_at
				END,
				updated_at = now()
			WHERE status = 'running'
				AND locked_at < now() - ($1 || ' milliseconds')::interval
			`,
			[this.lockTimeoutMs],
		);
	}

	private async claimNext(): Promise<BackgroundJob | null> {
		const result: unknown = await this.dataSource.query(
			`
			WITH picked AS (
				SELECT id
				FROM background_jobs
				WHERE status IN ('pending', 'failed')
					AND available_at <= now()
				ORDER BY available_at ASC, created_at ASC
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			)
			UPDATE background_jobs job
			SET status = 'running',
				attempt_count = job.attempt_count + 1,
				locked_at = now(),
				locked_by = $1,
				updated_at = now()
			FROM picked
			WHERE job.id = picked.id
			RETURNING job.id,
				job.tenant_id,
				job.job_type,
				job.payload,
				job.attempt_count,
				job.max_attempts
			`,
			[this.instanceId],
		);
		const rows: JobRow[] =
			Array.isArray(result) && Array.isArray(result[0])
				? (result[0] as JobRow[])
				: ((result as JobRow[]) ?? []);
		const row = rows[0];
		if (row === undefined) {
			return null;
		}
		return {
			id: row.id,
			tenantId: row.tenant_id,
			jobType: row.job_type,
			payload: row.payload,
			attemptCount: row.attempt_count,
			maxAttempts: row.max_attempts,
		} as BackgroundJob;
	}

	private async execute(job: BackgroundJob): Promise<void> {
		const handler = this.registry.get(job.jobType);
		if (handler === undefined) {
			await this.fail(
				job,
				new JobError(`No handler for job type ${job.jobType}.`, "NO_HANDLER"),
			);
			return;
		}
		try {
			await handler.handle(job);
			await this.succeed(job);
			this.logger.debug(`Completed job ${job.id} (${job.jobType})`);
		} catch (error) {
			await this.fail(job, error);
		}
	}

	private async succeed(job: BackgroundJob): Promise<void> {
		await this.dataSource.query(
			`
			UPDATE background_jobs
			SET status = 'succeeded',
				completed_at = now(),
				locked_at = NULL,
				locked_by = NULL,
				last_error_code = NULL,
				updated_at = now()
			WHERE id = $1
			`,
			[job.id],
		);
	}

	private async fail(job: BackgroundJob, error: unknown): Promise<void> {
		const exhausted = job.attemptCount >= job.maxAttempts;
		const code = error instanceof JobError ? error.code : "UNHANDLED_ERROR";
		const message = this.describe(error);
		const backoffMs =
			Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.min(job.attemptCount, 8)) * 1000;
		await this.dataSource.query(
			`
			UPDATE background_jobs
			SET status = $2,
				available_at = now() + ($3 || ' milliseconds')::interval,
				locked_at = NULL,
				locked_by = NULL,
				last_error_code = $4,
				last_error = $5,
				completed_at = CASE WHEN $2 = 'dead' THEN now() ELSE completed_at END,
				updated_at = now()
			WHERE id = $1
			`,
			[job.id, exhausted ? "dead" : "failed", backoffMs, code, message],
		);
		this.logger.warn(
			`Job ${job.id} (${job.jobType}) ${exhausted ? "dead" : `failed, retry in ${backoffMs}ms`}: ${message}`,
		);
	}

	private describe(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}
