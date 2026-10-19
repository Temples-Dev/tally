import { createHmac, randomUUID } from "node:crypto";
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
import { TenantMember } from "../../src/identity/entities/tenant-member.entity";
import { MemberRole, MemberStatus } from "../../src/identity/enums";
import { JobRunnerModule } from "../../src/jobs/job-runner.module";
import { UsageAggregationModule } from "../../src/usage/aggregation/usage-aggregation.module";

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

describe("Usage metering ingestion (integration)", () => {
	let container: StartedPostgreSqlContainer;
	let app: INestApplication;
	let dataSource: DataSource;

	const alice = mintToken("alice");
	const bob = mintToken("bob");
	const carol = mintToken("carol");

	let tenantA = "";
	let tenantB = "";
	let metricId = "";
	let customerA = "";
	let customerA2 = "";
	let customerB = "";
	let subscriptionA = "";
	let aggregationMetricId = "";
	let aggregationFrom: Date;
	let aggregationTo: Date;
	let acceptedEventId = "";
	let acceptedOccurredAt = "";

	beforeAll(async () => {
		container = await new PostgreSqlContainer("postgres:16-alpine").start();

		process.env.NODE_ENV = "test";
		process.env.DATABASE_URL = container.getConnectionUri();
		process.env.CORS_ORIGINS = "http://localhost:5173";
		process.env.AUTH_JWT_SECRET = JWT_SECRET;
		process.env.JOB_POLL_INTERVAL_MS = "50";

		const { AppModule } = await import("../../src/app.module");
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule, UsageAggregationModule, JobRunnerModule],
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
				.send({ name: "Acme Corp" })
		).body.id as string;
		tenantB = (
			await request(app.getHttpServer())
				.post("/v1/tenants")
				.set("Authorization", `Bearer ${bob}`)
				.send({ name: "Beta LLC" })
		).body.id as string;
		await dataSource.getRepository(TenantMember).save({
			tenantId: tenantA,
			externalIdentityId: "carol",
			role: MemberRole.VIEWER,
			status: MemberStatus.ACTIVE,
		});

		const metric = await api(alice, tenantA)
			.post("/meters")
			.send({
				code: "api.requests",
				name: "API requests",
				unit: "request",
				allowedDimensions: ["region"],
			});
		expect(metric.status).toBe(201);
		metricId = metric.body.id as string;

		customerA = await createCustomer(tenantA, alice, "Acme API");
		customerA2 = await createCustomer(tenantA, alice, "Acme Secondary");
		customerB = await createCustomer(tenantB, bob, "Beta API");

		const aggregationMetric = await api(alice, tenantA).post("/meters").send({
			code: "agg.requests",
			name: "Aggregated requests",
			unit: "request",
		});
		expect(aggregationMetric.status).toBe(201);
		aggregationMetricId = aggregationMetric.body.id as string;

		const product = await api(alice, tenantA)
			.post("/products")
			.send({ code: "USAGE", name: "Usage" });
		const plan = await api(alice, tenantA)
			.post("/plans")
			.send({ productId: product.body.id, code: "usage", name: "Usage" });
		const version = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions`)
			.send({});
		await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/publish`)
			.send({});
		const subscription = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customerA,
			planVersionId: version.body.id,
		});
		expect(subscription.status).toBe(201);
		subscriptionA = subscription.body.id as string;
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
		};
	}

	async function createCustomer(
		tenant: string,
		identity: string,
		displayName: string,
	): Promise<string> {
		const response = await api(identity, tenant)
			.post("/customers")
			.send({ displayName });
		expect(response.status).toBe(201);
		return response.body.id as string;
	}

	function event(
		overrides: Record<string, unknown> = {},
	): Record<string, unknown> {
		return {
			externalEventId: `evt-${randomUUID()}`,
			source: "api-gateway",
			customerAccountId: customerA,
			metricId,
			quantity: "1",
			occurredAt: new Date(Date.now() - 1000).toISOString(),
			...overrides,
		};
	}

	it("accepts, normalizes, and returns a usage event", async () => {
		acceptedOccurredAt = new Date(Date.now() - 1000).toISOString();
		const response = await api(alice, tenantA)
			.post("/usage/events")
			.send({
				externalEventId: "evt-accepted-1",
				source: "api-gateway",
				customerAccountId: customerA,
				metricId,
				quantity: "1.50000000",
				occurredAt: acceptedOccurredAt,
				dimensions: { region: "eu" },
			});
		expect(response.status).toBe(201);
		expect(response.body.status).toBe("accepted");
		expect(response.body.event).toMatchObject({
			externalEventId: "evt-accepted-1",
			quantity: "1.5",
			dimensions: { region: "eu" },
			status: "accepted",
		});
		acceptedEventId = response.body.event.id as string;
	});

	it("returns the original event for an identical retry", async () => {
		const response = await api(alice, tenantA)
			.post("/usage/events")
			.send({
				externalEventId: "evt-accepted-1",
				source: "api-gateway",
				customerAccountId: customerA,
				metricId,
				quantity: "1.5",
				occurredAt: acceptedOccurredAt,
				dimensions: { region: "eu" },
			});
		expect(response.status).toBe(200);
		expect(response.body.status).toBe("duplicate");
		expect(response.body.event.id).toBe(acceptedEventId);
	});

	it("conflicts when a duplicate identifier carries a different payload", async () => {
		const response = await api(alice, tenantA)
			.post("/usage/events")
			.send({
				externalEventId: "evt-accepted-1",
				source: "api-gateway",
				customerAccountId: customerA,
				metricId,
				quantity: "2",
				occurredAt: acceptedOccurredAt,
				dimensions: { region: "eu" },
			});
		expect(response.status).toBe(409);
	});

	it("enforces metric quantity, dimension, and event-time policy", async () => {
		const negative = await api(alice, tenantA)
			.post("/usage/events")
			.send(event({ quantity: "-1" }));
		expect(negative.status).toBe(422);

		const future = await api(alice, tenantA)
			.post("/usage/events")
			.send(
				event({ occurredAt: new Date(Date.now() + 3_600_000).toISOString() }),
			);
		expect(future.status).toBe(422);

		const dimension = await api(alice, tenantA)
			.post("/usage/events")
			.send(event({ dimensions: { country: "US" } }));
		expect(dimension.status).toBe(422);

		const old = await api(alice, tenantA)
			.post("/usage/events")
			.send(
				event({ occurredAt: new Date(Date.now() - 86_400_000).toISOString() }),
			);
		expect(old.status).toBe(201);
	});

	it("rejects unknown or cross-tenant references", async () => {
		const unknownMetric = await api(alice, tenantA)
			.post("/usage/events")
			.send(event({ metricId: randomUUID() }));
		expect(unknownMetric.status).toBe(404);

		const foreignCustomer = await api(alice, tenantA)
			.post("/usage/events")
			.send(event({ customerAccountId: customerB }));
		expect(foreignCustomer.status).toBe(404);

		const mismatchedSubscription = await api(alice, tenantA)
			.post("/usage/events")
			.send(
				event({ customerAccountId: customerA2, subscriptionId: subscriptionA }),
			);
		expect(mismatchedSubscription.status).toBe(422);
	});

	it("processes batches with per-event outcomes", async () => {
		const response = await api(alice, tenantA)
			.post("/usage/events/batch")
			.send({
				events: [
					event({ externalEventId: "evt-batch-accepted" }),
					event({ externalEventId: "evt-batch-invalid", quantity: "abc" }),
					{
						externalEventId: "evt-accepted-1",
						source: "api-gateway",
						customerAccountId: customerA,
						metricId,
						quantity: "1.5",
						occurredAt: acceptedOccurredAt,
						dimensions: { region: "eu" },
					},
				],
			});
		expect(response.status).toBe(200);
		expect(response.body.results).toMatchObject([
			{ index: 0, status: "accepted" },
			{ index: 1, status: "rejected" },
			{ index: 2, status: "duplicate" },
		]);
	});

	it("lists events with cursor pagination and retrieves one by id", async () => {
		const listMetric = await api(alice, tenantA)
			.post("/meters")
			.send({ code: "list.metric", name: "List metric", unit: "unit" });
		expect(listMetric.status).toBe(201);
		for (let index = 0; index < 3; index += 1) {
			const response = await api(alice, tenantA)
				.post("/usage/events")
				.send(
					event({
						externalEventId: `evt-list-${index}`,
						metricId: listMetric.body.id,
						occurredAt: new Date(
							Date.now() - 3000 + index * 1000,
						).toISOString(),
					}),
				);
			expect(response.status).toBe(201);
		}

		const firstPage = await api(alice, tenantA).get(
			`/usage/events?metricId=${listMetric.body.id}&limit=2`,
		);
		expect(firstPage.status).toBe(200);
		expect(firstPage.body.data).toHaveLength(2);
		expect(firstPage.body.pagination.hasMore).toBe(true);
		const cursor = firstPage.body.pagination.nextCursor as string;
		expect(cursor).toBeTruthy();

		const secondPage = await api(alice, tenantA).get(
			`/usage/events?metricId=${listMetric.body.id}&limit=2&cursor=${encodeURIComponent(cursor)}`,
		);
		expect(secondPage.status).toBe(200);
		expect(secondPage.body.data).toHaveLength(1);
		expect(secondPage.body.pagination.hasMore).toBe(false);
		expect(secondPage.body.data[0].id).not.toBe(firstPage.body.data[1].id);

		const single = await api(alice, tenantA).get(
			`/usage/events/${acceptedEventId}`,
		);
		expect(single.status).toBe(200);
		expect(single.body.id).toBe(acceptedEventId);

		const missing = await api(alice, tenantA).get(
			`/usage/events/${randomUUID()}`,
		);
		expect(missing.status).toBe(404);
	});

	function utcStart(ms: number): Date {
		const value = new Date(ms);
		return new Date(
			Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
		);
	}

	interface SummaryBody {
		total: string | null;
		eventCount: number;
		metric: { unit: string; aggregationMethod: string };
		aggregates: Array<{ revision: number }>;
		freshness: { lastCalculatedAt: string | null };
	}

	async function waitForSummary(
		metric: string,
		from: Date,
		to: Date,
		expectedTotal: string,
		expectedCount: number,
	): Promise<SummaryBody> {
		const deadline = Date.now() + 20_000;
		let lastBody: unknown;
		while (Date.now() < deadline) {
			const response = await api(alice, tenantA).get(
				`/usage/summary?metricId=${metric}&from=${encodeURIComponent(
					from.toISOString(),
				)}&to=${encodeURIComponent(to.toISOString())}`,
			);
			lastBody = response.body;
			const body = response.body as SummaryBody;
			if (
				response.status === 200 &&
				body.total === expectedTotal &&
				body.eventCount === expectedCount
			) {
				return body;
			}
			await delay(50);
		}
		throw new Error(
			`Timed out waiting for summary ${expectedTotal}: ${JSON.stringify(lastBody)}`,
		);
	}

	it("aggregates events and re-aggregates late arrivals", async () => {
		const now = Date.now();
		const base = now - 5 * 60_000;
		const from = utcStart(base);
		const to = new Date(utcStart(now).getTime() + 86_400_000);
		aggregationFrom = from;
		aggregationTo = to;

		const first = await api(alice, tenantA)
			.post("/usage/events")
			.send({
				externalEventId: "evt-agg-1",
				source: "aggregation-test",
				customerAccountId: customerA,
				metricId: aggregationMetricId,
				quantity: "1.25",
				occurredAt: new Date(base).toISOString(),
			});
		expect(first.status).toBe(201);

		const second = await api(alice, tenantA)
			.post("/usage/events")
			.send({
				externalEventId: "evt-agg-2",
				source: "aggregation-test",
				customerAccountId: customerA,
				metricId: aggregationMetricId,
				quantity: "2",
				occurredAt: new Date(base + 1_000).toISOString(),
			});
		expect(second.status).toBe(201);

		const duplicate = await api(alice, tenantA)
			.post("/usage/events")
			.send({
				externalEventId: "evt-agg-1",
				source: "aggregation-test",
				customerAccountId: customerA,
				metricId: aggregationMetricId,
				quantity: "1.25",
				occurredAt: new Date(base).toISOString(),
			});
		expect(duplicate.status).toBe(200);

		const initial = await waitForSummary(
			aggregationMetricId,
			from,
			to,
			"3.25",
			2,
		);
		expect(initial.metric.unit).toBe("request");
		expect(initial.metric.aggregationMethod).toBe("sum");
		expect(initial.freshness.lastCalculatedAt).toBeTruthy();

		const late = await api(alice, tenantA)
			.post("/usage/events")
			.send({
				externalEventId: "evt-agg-3",
				source: "aggregation-test",
				customerAccountId: customerA,
				metricId: aggregationMetricId,
				quantity: "0.75",
				occurredAt: new Date(base + 2_000).toISOString(),
			});
		expect(late.status).toBe(201);

		const updated = await waitForSummary(aggregationMetricId, from, to, "4", 3);
		expect(updated.aggregates.some((aggregate) => aggregate.revision > 1)).toBe(
			true,
		);

		const misaligned = await api(alice, tenantA).get(
			`/usage/summary?metricId=${aggregationMetricId}&from=${encodeURIComponent(
				new Date(from.getTime() + 3_600_000).toISOString(),
			)}&to=${encodeURIComponent(to.toISOString())}`,
		);
		expect(misaligned.status).toBe(422);
	});

	it("applies count, max, and last aggregation methods", async () => {
		const now = Date.now();
		const base = now - 5 * 60_000;
		const from = utcStart(base);
		const to = new Date(utcStart(now).getTime() + 86_400_000);

		async function createMetric(
			code: string,
			aggregationMethod: string,
		): Promise<string> {
			const response = await api(alice, tenantA).post("/meters").send({
				code,
				name: code,
				unit: "unit",
				aggregationMethod,
			});
			expect(response.status).toBe(201);
			return response.body.id as string;
		}

		const countMetric = await createMetric("agg.count", "count");
		const maxMetric = await createMetric("agg.max", "max");
		const lastMetric = await createMetric("agg.last", "last");

		for (const [metricId, suffix] of [
			[countMetric, "count"],
			[maxMetric, "max"],
			[lastMetric, "last"],
		] as const) {
			await api(alice, tenantA)
				.post("/usage/events")
				.send({
					externalEventId: `evt-${suffix}-1`,
					source: "aggregation-test",
					customerAccountId: customerA,
					metricId,
					quantity: "7",
					occurredAt: new Date(base).toISOString(),
				});
			await api(alice, tenantA)
				.post("/usage/events")
				.send({
					externalEventId: `evt-${suffix}-2`,
					source: "aggregation-test",
					customerAccountId: customerA,
					metricId,
					quantity: "5",
					occurredAt: new Date(base + 1_000).toISOString(),
				});
		}

		expect((await waitForSummary(countMetric, from, to, "2", 2)).total).toBe(
			"2",
		);
		expect((await waitForSummary(maxMetric, from, to, "7", 2)).total).toBe("7");
		expect((await waitForSummary(lastMetric, from, to, "5", 2)).total).toBe(
			"5",
		);
	});

	it("reports processing status and reconciles aggregates", async () => {
		const deadline = Date.now() + 20_000;
		let status = 0;
		let body: {
			backlogClear?: boolean;
			events?: { count?: number; latestReceivedAt?: string | null };
			aggregates?: { lastCalculatedAt?: string | null };
			backlog?: { lastCompletedAt?: string | null };
		} = {};
		while (Date.now() < deadline) {
			const response = await api(alice, tenantA).get(
				`/usage/processing-status?metricId=${aggregationMetricId}`,
			);
			status = response.status;
			body = response.body;
			if (status === 200 && body.backlogClear === true) {
				break;
			}
			await delay(50);
		}
		expect(status).toBe(200);
		expect(body.backlogClear).toBe(true);
		expect(body.events?.count).toBe(3);
		expect(body.events?.latestReceivedAt).toBeTruthy();
		expect(body.aggregates?.lastCalculatedAt).toBeTruthy();
		expect(body.backlog?.lastCompletedAt).toBeTruthy();

		const reconciliation = await api(alice, tenantA).get(
			`/usage/reconciliation?metricId=${aggregationMetricId}&from=${encodeURIComponent(
				aggregationFrom.toISOString(),
			)}&to=${encodeURIComponent(aggregationTo.toISOString())}`,
		);
		expect(reconciliation.status).toBe(200);
		expect(reconciliation.body).toMatchObject({
			eventTotal: "4",
			aggregateTotal: "4",
			eventCount: 3,
			aggregateEventCount: 3,
			matches: true,
			difference: "0",
		});
	});

	it("enforces roles and tenant isolation", async () => {
		const viewerRead = await api(carol, tenantA).get(
			`/usage/events/${acceptedEventId}`,
		);
		expect(viewerRead.status).toBe(200);

		const viewerWrite = await api(carol, tenantA)
			.post("/usage/events")
			.send(event());
		expect(viewerWrite.status).toBe(403);

		const crossTenant = await api(bob, tenantB).get(
			`/usage/events/${acceptedEventId}`,
		);
		expect(crossTenant.status).toBe(404);
	});
});
