import { setTimeout as delay } from "node:timers/promises";

import {
	type INestApplication,
	Injectable,
	type OnModuleInit,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
	PostgreSqlContainer,
	type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { DataSource } from "typeorm";

import { validateEnvironment } from "../../src/config/environment.validation";
import { typeOrmOptions } from "../../src/database/typeorm-options";
import { BackgroundJobsService } from "../../src/jobs/background-jobs.service";
import { BackgroundJob } from "../../src/jobs/entities/background-job.entity";
import { BackgroundJobStatus } from "../../src/jobs/enums";
import { JobError, type JobHandler } from "../../src/jobs/job-handler";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { JobRegistry } from "../../src/jobs/job-registry.service";
import { JobRunnerModule } from "../../src/jobs/job-runner.module";
import { JobsModule } from "../../src/jobs/jobs.module";

jest.setTimeout(120_000);

@Injectable()
class EchoJobHandler implements JobHandler, OnModuleInit {
	readonly jobType = "test.echo";
	static handled: string[] = [];

	constructor(private readonly registry: JobRegistry) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	async handle(job: BackgroundJob): Promise<void> {
		EchoJobHandler.handled.push(job.id);
	}
}

@Injectable()
class FailingJobHandler implements JobHandler, OnModuleInit {
	readonly jobType = "test.fail";
	static attempts = 0;

	constructor(private readonly registry: JobRegistry) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	async handle(): Promise<void> {
		FailingJobHandler.attempts += 1;
		throw new JobError("Intentional test failure.", "TEST_BOOM");
	}
}

describe("Background jobs (integration)", () => {
	let container: StartedPostgreSqlContainer;
	let app: INestApplication;
	let dataSource: DataSource;
	let jobs: BackgroundJobsService;

	beforeAll(async () => {
		container = await new PostgreSqlContainer("postgres:16-alpine").start();

		process.env.NODE_ENV = "test";
		process.env.DATABASE_URL = container.getConnectionUri();
		process.env.CORS_ORIGINS = "http://localhost:5173";
		process.env.AUTH_JWT_SECRET = "integration-secret-with-enough-length";
		process.env.JOB_POLL_INTERVAL_MS = "50";
		EchoJobHandler.handled = [];
		FailingJobHandler.attempts = 0;

		const moduleRef = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					validate: validateEnvironment,
				}),
				TypeOrmModule.forRootAsync({
					imports: [ConfigModule],
					useFactory: typeOrmOptions,
					inject: [ConfigService],
				}),
				JobsModule,
				JobRunnerModule,
			],
			providers: [EchoJobHandler, FailingJobHandler],
		}).compile();

		app = moduleRef.createNestApplication({ logger: false });
		await app.init();

		dataSource = moduleRef.get(DataSource);
		await dataSource.runMigrations();
		jobs = moduleRef.get(BackgroundJobsService);
	});

	afterAll(async () => {
		await app?.close();
		await container?.stop();
	});

	async function waitForJob(
		id: string,
		timeoutMs = 15_000,
	): Promise<BackgroundJob> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const job = await dataSource
				.getRepository(BackgroundJob)
				.findOneBy({ id });
			if (
				job !== null &&
				(job.status === BackgroundJobStatus.SUCCEEDED ||
					job.status === BackgroundJobStatus.DEAD)
			) {
				return job;
			}
			await delay(50);
		}
		throw new Error(`Timed out waiting for job ${id}.`);
	}

	it("executes an enqueued job and marks it succeeded", async () => {
		const job = await jobs.enqueue({
			jobType: "test.echo",
			idempotencyKey: "echo-1",
			payload: { value: 42 },
		});

		const completed = await waitForJob(job.id);
		expect(completed.status).toBe(BackgroundJobStatus.SUCCEEDED);
		expect(completed.attemptCount).toBe(1);
		expect(completed.completedAt).not.toBeNull();
		expect(EchoJobHandler.handled).toContain(job.id);
	});

	it("deduplicates jobs by type and idempotency key", async () => {
		const first = await jobs.enqueue({
			jobType: "test.echo",
			idempotencyKey: "echo-dedupe",
		});
		const second = await jobs.enqueue({
			jobType: "test.echo",
			idempotencyKey: "echo-dedupe",
		});

		expect(second.id).toBe(first.id);
		const count = await dataSource
			.getRepository(BackgroundJob)
			.countBy({ jobType: "test.echo", idempotencyKey: "echo-dedupe" });
		expect(count).toBe(1);
	});

	it("enqueues idempotently inside a transaction", async () => {
		const id = await dataSource.transaction(async (manager) => {
			const first = await jobs.enqueue(
				{ jobType: "test.echo", idempotencyKey: "tx-dedupe" },
				manager,
			);
			const second = await jobs.enqueue(
				{ jobType: "test.echo", idempotencyKey: "tx-dedupe" },
				manager,
			);
			expect(second.id).toBe(first.id);
			return first.id;
		});

		const completed = await waitForJob(id);
		expect(completed.status).toBe(BackgroundJobStatus.SUCCEEDED);
	});

	it("retries a failing job and moves it to dead after max attempts", async () => {
		const job = await jobs.enqueue({
			jobType: "test.fail",
			idempotencyKey: "fail-once",
			maxAttempts: 2,
		});

		const completed = await waitForJob(job.id);
		expect(completed.status).toBe(BackgroundJobStatus.DEAD);
		expect(completed.attemptCount).toBe(2);
		expect(completed.lastErrorCode).toBe("TEST_BOOM");
		expect(FailingJobHandler.attempts).toBe(2);
	});
});
