import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
	PostgreSqlContainer,
	type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import request from "supertest";
import { DataSource } from "typeorm";

import { configureApp } from "../../src/app-setup";
import { JobRunnerModule } from "../../src/jobs/job-runner.module";

jest.setTimeout(180_000);

const JWT_SECRET = "integration-secret-with-enough-length";

function mintToken(sub: string): string {
	const encode = (value: object): string =>
		Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
	const encodedHeader = encode({ alg: "HS256", typ: "JWT" });
	const encodedPayload = encode({ sub });
	const signature = createHmac("sha256", JWT_SECRET)
		.update(`${encodedHeader}.${encodedPayload}`)
		.digest("base64url");
	return `${encodedHeader}.${encodedPayload}.${signature}`;
}

describe("Quotas and enforcement (integration)", () => {
	let container: StartedPostgreSqlContainer;
	let app: INestApplication;
	let dataSource: DataSource;

	const alice = mintToken("alice-quota");
	const bob = mintToken("bob-quota");

	let tenantA = "";
	let tenantB = "";
	let subscriptionA = "";
	let hardMetric = "";
	let softMetric = "";
	let concurrentMetric = "";
	let unmeteredMetric = "";
	let hardLimitMetric = "";
	let raceMetric = "";

	beforeAll(async () => {
		container = await new PostgreSqlContainer("postgres:16-alpine").start();

		process.env.NODE_ENV = "test";
		process.env.DATABASE_URL = container.getConnectionUri();
		process.env.CORS_ORIGINS = "http://localhost:5173";
		process.env.AUTH_JWT_SECRET = JWT_SECRET;
		process.env.JOB_POLL_INTERVAL_MS = "50";

		const { AppModule } = await import("../../src/app.module");
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule, JobRunnerModule],
		}).compile();

		app = moduleRef.createNestApplication({ logger: false });
		configureApp(app);
		await app.init();

		dataSource = moduleRef.get(DataSource);
		await dataSource.runMigrations();

		tenantA = (
			await request(app.getHttpServer())
				.post("/v1/tenants")
				.set("Authorization", `Bearer ${alice}`)
				.send({ name: "Quota Corp" })
		).body.id as string;
		tenantB = (
			await request(app.getHttpServer())
				.post("/v1/tenants")
				.set("Authorization", `Bearer ${bob}`)
				.send({ name: "Quota Beta" })
		).body.id as string;

		const product = await api(alice, tenantA)
			.post("/products")
			.send({ code: "QUOTA", name: "Quota product" });
		const plan = await api(alice, tenantA)
			.post("/plans")
			.send({ productId: product.body.id, code: "quota", name: "Quota plan" });
		const version = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions`)
			.send({});
		await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/publish`)
			.send({});
		const customer = await api(alice, tenantA)
			.post("/customers")
			.send({ displayName: "Quota customer" });
		const subscription = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customer.body.id,
			planVersionId: version.body.id,
		});
		expect(subscription.status).toBe(201);
		subscriptionA = subscription.body.id as string;

		hardMetric = await createMetric("quota.hard");
		softMetric = await createMetric("quota.soft");
		concurrentMetric = await createMetric("quota.concurrent");
		unmeteredMetric = await createMetric("quota.unmetered");
		hardLimitMetric = await createMetric("quota.boundary");
		raceMetric = await createMetric("quota.race");

		await createPolicy({
			metricId: hardMetric,
			limitValue: "5",
			windowType: "day",
			enforcementMode: "hard",
		});
		await createPolicy({
			metricId: softMetric,
			limitValue: "1",
			windowType: "day",
			enforcementMode: "soft",
		});
		await createPolicy({
			metricId: concurrentMetric,
			limitValue: "2",
			windowType: "concurrent",
			enforcementMode: "concurrent",
		});
		await createPolicy({
			metricId: unmeteredMetric,
			unmetered: true,
			windowType: "lifetime",
			enforcementMode: "observe_only",
		});
		await createPolicy({
			metricId: hardLimitMetric,
			limitValue: "2",
			windowType: "day",
			enforcementMode: "hard",
		});
		await createPolicy({
			metricId: raceMetric,
			limitValue: "5",
			windowType: "day",
			enforcementMode: "hard",
		});
	});

	afterAll(async () => {
		await app?.close();
		await container?.stop();
	});

	function api(identity: string, tenant: string) {
		const agent = request(app.getHttpServer());
		return {
			get: (path: string) =>
				agent
					.get(`/v1${path}`)
					.set("Authorization", `Bearer ${identity}`)
					.set("x-tenant-id", tenant),
			post: (path: string) =>
				agent
					.post(`/v1${path}`)
					.set("Authorization", `Bearer ${identity}`)
					.set("x-tenant-id", tenant),
			patch: (path: string) =>
				agent
					.patch(`/v1${path}`)
					.set("Authorization", `Bearer ${identity}`)
					.set("x-tenant-id", tenant),
		};
	}

	async function createMetric(code: string): Promise<string> {
		const response = await api(alice, tenantA)
			.post("/meters")
			.send({ code, name: code, unit: "unit" });
		expect(response.status).toBe(201);
		return response.body.id as string;
	}

	async function createPolicy(input: Record<string, unknown>) {
		const response = await api(alice, tenantA)
			.post(`/tenants/${tenantA}/quotas`)
			.send({ subscriptionId: subscriptionA, ...input });
		expect(response.status).toBe(201);
		return response.body;
	}

	async function reserve(
		key: string,
		amount: string,
		operationId: string,
		extra: Record<string, unknown> = {},
	) {
		return api(alice, tenantA)
			.post("/quota-reservations")
			.send({ key, amount, operationId, ...extra });
	}

	it("lists and retrieves effective quotas with accounting", async () => {
		const list = await api(alice, tenantA).get(`/tenants/${tenantA}/quotas`);
		expect(list.status).toBe(200);
		expect(list.body).toHaveLength(6);
		const hard = list.body.find(
			(quota: { key: string }) => quota.key === "quota.hard",
		);
		expect(hard).toMatchObject({
			limit: "5",
			unmetered: false,
			enforcementMode: "hard",
			windowType: "day",
			accounting: {
				used: "0",
				reserved: "0",
				remaining: "5",
				status: "ok",
			},
		});

		const one = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.hard`,
		);
		expect(one.status).toBe(200);
		expect(one.body.key).toBe("quota.hard");

		const missing = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.none`,
		);
		expect(missing.status).toBe(404);
	});

	it("reserves capacity atomically and enforces hard limits", async () => {
		const first = await reserve("quota.hard", "3", "op-hard-1");
		expect(first.status).toBe(201);
		expect(first.body.status).toBe("reserved");
		expect(first.body.amount).toBe("3");

		const projected = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.hard`,
		);
		expect(projected.body.accounting).toMatchObject({
			used: "0",
			reserved: "3",
			remaining: "2",
		});

		const over = await reserve("quota.hard", "3", "op-hard-2");
		expect(over.status).toBe(409);

		const unchanged = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.hard`,
		);
		expect(unchanged.body.accounting.reserved).toBe("3");

		const retry = await reserve("quota.hard", "3", "op-hard-1");
		expect(retry.status).toBe(201);
		expect(retry.body.id).toBe(first.body.id);

		const conflict = await reserve("quota.hard", "4", "op-hard-1");
		expect(conflict.status).toBe(409);
	});

	it("commits at actual usage and releases unused capacity", async () => {
		const reservations = await dataSource.query(
			"SELECT id FROM quota_reservations WHERE operation_id = 'op-hard-1'",
		);
		const reservationId = reservations[0].id as string;

		const commit = await api(alice, tenantA).post(
			`/quota-reservations/${reservationId}/commit`,
		);
		expect(commit.status).toBe(200);
		expect(commit.body).toMatchObject({
			status: "committed",
			committedQuantity: "3",
		});
		const idempotent = await api(alice, tenantA).post(
			`/quota-reservations/${reservationId}/commit`,
		);
		expect(idempotent.status).toBe(200);
		expect(idempotent.body.id).toBe(commit.body.id);

		const afterCommit = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.hard`,
		);
		expect(afterCommit.body.accounting).toMatchObject({
			used: "3",
			reserved: "0",
			remaining: "2",
		});

		const second = await reserve("quota.hard", "2", "op-hard-3");
		expect(second.status).toBe(201);
		const release = await api(alice, tenantA).post(
			`/quota-reservations/${second.body.id}/release`,
		);
		expect(release.status).toBe(200);
		expect(release.body.status).toBe("released");

		const afterRelease = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.hard`,
		);
		expect(afterRelease.body.accounting).toMatchObject({
			used: "3",
			reserved: "0",
			remaining: "2",
		});

		const exact = await reserve("quota.hard", "2", "op-hard-4");
		expect(exact.status).toBe(201);
		const exceeded = await reserve("quota.hard", "0.00000001", "op-hard-5");
		expect(exceeded.status).toBe(409);
	});

	it("allows soft overages with an explicit warning state", async () => {
		const reservation = await reserve("quota.soft", "2", "op-soft-1");
		expect(reservation.status).toBe(201);
		expect(reservation.body.exceeded).toBe(true);

		const quota = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.soft`,
		);
		expect(quota.body.accounting).toMatchObject({
			overLimit: true,
			status: "exceeded",
			remaining: "0",
		});
	});

	it("treats unmetered quotas as explicit instead of unlimited numbers", async () => {
		const reservation = await reserve(
			"quota.unmetered",
			"999999999",
			"op-unmetered-1",
		);
		expect(reservation.status).toBe(201);
		const quota = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.unmetered`,
		);
		expect(quota.body).toMatchObject({
			limit: null,
			unmetered: true,
			accounting: {
				remaining: null,
				status: "unmetered",
			},
		});
	});

	it("limits concurrent reservations and frees slots on commit", async () => {
		const first = await reserve("quota.concurrent", "1", "op-conc-1");
		const second = await reserve("quota.concurrent", "1", "op-conc-2");
		expect(first.status).toBe(201);
		expect(second.status).toBe(201);

		const third = await reserve("quota.concurrent", "1", "op-conc-3");
		expect(third.status).toBe(409);

		const commit = await api(alice, tenantA).post(
			`/quota-reservations/${first.body.id}/commit`,
		);
		expect(commit.status).toBe(200);
		const fourth = await reserve("quota.concurrent", "1", "op-conc-4");
		expect(fourth.status).toBe(201);

		const quota = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.concurrent`,
		);
		expect(quota.body.accounting.reserved).toBe("2");
		expect(quota.body.accounting.used).toBe("0");
	});

	it("never oversubscribes a hard limit under concurrent requests", async () => {
		const attempts = await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				reserve("quota.race", "1", `op-race-${index}`),
			),
		);
		const accepted = attempts.filter((entry) => entry.status === 201);
		const rejected = attempts.filter((entry) => entry.status === 409);
		expect(accepted).toHaveLength(5);
		expect(rejected).toHaveLength(7);

		const quota = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.race`,
		);
		expect(quota.body.accounting).toMatchObject({
			used: "0",
			reserved: "5",
			remaining: "0",
		});
	});

	it("reconciles reservations against counters", async () => {
		const reconciliation = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/reconciliation`,
		);
		expect(reconciliation.status).toBe(200);
		expect(reconciliation.body.matches).toBe(true);
		expect(reconciliation.body.discrepancies).toEqual([]);
	});

	it("expires stale reservations through the job runner", async () => {
		const reservation = await reserve("quota.boundary", "2", "op-expire-1", {
			ttlSeconds: 1,
		});
		expect(reservation.status).toBe(201);

		const deadline = Date.now() + 15_000;
		let body: { status?: string } = {};
		while (Date.now() < deadline) {
			const current = await api(alice, tenantA).get(
				`/quota-reservations/${reservation.body.id}`,
			);
			body = current.body;
			if (body.status === "expired") {
				break;
			}
			await delay(100);
		}
		expect(body.status).toBe("expired");

		const quota = await api(alice, tenantA).get(
			`/tenants/${tenantA}/quotas/quota.boundary`,
		);
		expect(quota.body.accounting.reserved).toBe("0");
	});

	it("isolates quota data by tenant", async () => {
		const hidden = await api(bob, tenantB).get(
			`/tenants/${tenantA}/quotas/quota.hard`,
		);
		expect(hidden.status).toBe(403);

		const own = await api(bob, tenantB).get(
			`/tenants/${tenantB}/quotas/quota.hard`,
		);
		expect(own.status).toBe(404);

		const reservation = await reserve(
			"quota.unmetered",
			"1",
			"op-cross-tenant",
		);
		const stolen = await api(bob, tenantB).get(
			`/quota-reservations/${reservation.body.id}`,
		);
		expect(stolen.status).toBe(404);
	});

	it("updates policy limits without rewriting prior counters", async () => {
		const updated = await api(alice, tenantA)
			.patch(`/tenants/${tenantA}/quotas/quota.boundary`)
			.send({ limitValue: "3" });
		expect(updated.status).toBe(200);
		expect(updated.body.limit).toBe("3");

		const invalid = await api(alice, tenantA)
			.patch(`/tenants/${tenantA}/quotas/quota.boundary`)
			.send({ limitValue: "-1" });
		expect(invalid.status).toBe(400);
	});
});
