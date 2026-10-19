import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
	PostgreSqlContainer,
	type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import request from "supertest";

import { configureApp } from "../../src/app-setup";

jest.setTimeout(60_000);

describe("Health (integration)", () => {
	let container: StartedPostgreSqlContainer;
	let app: INestApplication;

	beforeAll(async () => {
		container = await new PostgreSqlContainer("postgres:16-alpine").start();

		process.env.NODE_ENV = "test";
		process.env.DATABASE_URL = container.getConnectionUri();
		process.env.CORS_ORIGINS = "http://localhost:5173";

		// Import after env vars are set: ConfigModule validates at import time.
		const { AppModule } = await import("../../src/app.module");
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();

		app = moduleRef.createNestApplication({ logger: false });
		configureApp(app);
		await app.init();
	});

	afterAll(async () => {
		await app?.close();
		await container?.stop();
	});

	it("GET /health/live returns alive", async () => {
		const response = await request(app.getHttpServer()).get("/v1/health/live");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ status: "alive" });
	});

	it("GET /health/ready returns ready", async () => {
		const response = await request(app.getHttpServer()).get("/v1/health/ready");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ status: "ready" });
	});

	it("GET /health reports database healthy", async () => {
		const response = await request(app.getHttpServer()).get("/v1/health");
		expect(response.status).toBe(200);
		expect(response.body.status).toBe("ok");
		expect(response.body.services).toEqual([
			expect.objectContaining({ name: "postgresql", status: "healthy" }),
		]);
	});
});
