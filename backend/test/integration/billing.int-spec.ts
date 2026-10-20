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
import { BillingService } from "../../src/billing/billing.service";
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

describe("Billing and invoicing (integration)", () => {
	let container: StartedPostgreSqlContainer;
	let app: INestApplication;
	let dataSource: DataSource;

	const alice = mintToken("alice-billing");
	const bob = mintToken("bob-billing");

	let tenantA = "";
	let tenantB = "";
	let subscriptionId = "";
	let metricId = "";
	let periodId = "";
	let invoiceId = "";

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
				.send({ name: "Billing Corp" })
		).body.id as string;
		tenantB = (
			await request(app.getHttpServer())
				.post("/v1/tenants")
				.set("Authorization", `Bearer ${bob}`)
				.send({ name: "Billing Beta" })
		).body.id as string;

		const product = await api(alice, tenantA)
			.post("/products")
			.send({ code: "BILLING", name: "Billing product" });
		expect(product.status).toBe(201);
		const plan = await api(alice, tenantA).post("/plans").send({
			productId: product.body.id,
			code: "launch",
			name: "Launch plan",
		});
		expect(plan.status).toBe(201);
		const version = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions`)
			.send({});
		expect(version.status).toBe(201);
		const published = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/publish`)
			.send({});
		expect(published.status).toBe(200);
		const customer = await api(alice, tenantA)
			.post("/customers")
			.send({ displayName: "Initech", email: "billing@initech.test" });
		expect(customer.status).toBe(201);
		const subscription = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customer.body.id,
			planVersionId: version.body.id,
		});
		expect(subscription.status).toBe(201);
		subscriptionId = subscription.body.id as string;

		const metric = await api(alice, tenantA)
			.post("/meters")
			.send({ code: "billing.api_calls", name: "API calls", unit: "call" });
		expect(metric.status).toBe(201);
		metricId = metric.body.id as string;
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

	it("creates versioned prices and rejects unsupported currencies", async () => {
		const planId = await currentPlanId();
		const invalid = await api(alice, tenantA)
			.post(`/plans/${planId}/prices`)
			.send({
				priceCode: "versioned",
				currency: "XYZ",
				billingInterval: "month",
				pricingModel: "flat",
				configuration: { amount: "49.99" },
			});
		expect(invalid.status).toBe(422);

		const created = await api(alice, tenantA)
			.post(`/plans/${planId}/prices`)
			.send({
				priceCode: "versioned",
				currency: "USD",
				billingInterval: "month",
				pricingModel: "flat",
				configuration: { amount: "49.99" },
				effectiveFrom: "2026-09-01T00:00:00.000Z",
				effectiveUntil: "2026-10-01T00:00:00.000Z",
			});
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			priceCode: "versioned",
			versionNumber: 1,
			currency: "USD",
			pricingModel: "flat",
			status: "active",
			configuration: { amount: "49.99" },
		});

		const overlap = await api(alice, tenantA)
			.post(`/plans/${planId}/prices`)
			.send({
				priceCode: "versioned",
				currency: "USD",
				billingInterval: "month",
				pricingModel: "flat",
				configuration: { amount: "59.99" },
				effectiveFrom: "2026-09-15T00:00:00.000Z",
				effectiveUntil: "2026-09-20T00:00:00.000Z",
			});
		expect(overlap.status).toBe(409);

		const nextVersion = await api(alice, tenantA)
			.post(`/plans/${planId}/prices`)
			.send({
				priceCode: "versioned",
				currency: "USD",
				billingInterval: "month",
				pricingModel: "flat",
				configuration: { amount: "59.99" },
				effectiveFrom: "2026-10-01T00:00:00.000Z",
			});
		expect(nextVersion.status).toBe(201);
		expect(nextVersion.body.versionNumber).toBe(2);

		const listed = await api(alice, tenantA).get(`/plans/${planId}/prices`);
		expect(listed.status).toBe(200);
		expect(listed.body).toHaveLength(2);
		expect(listed.body[0].versionNumber).toBe(2);
	});

	it("attaches subscription items with quantities", async () => {
		const planId = await currentPlanId();
		const base = await createPrice(planId, {
			priceCode: "base",
			pricingModel: "flat",
			configuration: { amount: "49.99" },
			effectiveFrom: "2026-09-01T00:00:00.000Z",
			effectiveUntil: "2026-10-01T00:00:00.000Z",
		});
		const seats = await createPrice(planId, {
			priceCode: "extra-seats",
			pricingModel: "per_unit",
			configuration: { unitAmount: "0.25" },
			effectiveFrom: "2026-09-01T00:00:00.000Z",
		});
		const calls = await createPrice(planId, {
			priceCode: "api-calls",
			pricingModel: "metered",
			configuration: {
				metricId,
				unitAmount: "0.10",
				includedUnits: "5",
			},
			effectiveFrom: "2026-09-01T00:00:00.000Z",
		});

		const baseItem = await attach(base.id, { quantity: "1" });
		expect(baseItem.status).toBe(201);
		expect(baseItem.body.quantity).toBe("1");

		const seatItem = await attach(seats.id, { quantity: "3" });
		expect(seatItem.status).toBe(201);
		const callItem = await attach(calls.id, {});
		expect(callItem.status).toBe(201);
		expect(callItem.body.quantity).toBe("1");

		const duplicate = await attach(seats.id, { quantity: "2" });
		expect(duplicate.status).toBe(409);

		const negative = await attach(seats.id, { quantity: "-1" });
		expect(negative.status).toBe(400);

		const listed = await api(alice, tenantA).get(
			`/subscriptions/${subscriptionId}/items`,
		);
		expect(listed.status).toBe(200);
		expect(listed.body).toHaveLength(3);
	});

	it("generates one invoice for a billing period idempotently", async () => {
		const created = await api(alice, tenantA).post("/billing-periods").send({
			subscriptionId,
			periodStart: "2026-09-01T00:00:00.000Z",
			periodEnd: "2026-10-01T00:00:00.000Z",
		});
		expect(created.status).toBe(201);
		expect(created.body.status).toBe("open");
		periodId = created.body.id as string;

		const duplicatePeriod = await api(alice, tenantA)
			.post("/billing-periods")
			.send({
				subscriptionId,
				periodStart: "2026-09-01T00:00:00.000Z",
				periodEnd: "2026-10-01T00:00:00.000Z",
			});
		expect(duplicatePeriod.status).toBe(201);
		expect(duplicatePeriod.body.id).toBe(periodId);

		await dataSource.query(
			`
			INSERT INTO usage_aggregates (
				tenant_id, customer_account_id, subscription_id, metric_id,
				period_start, period_end, dimensions, scope_key,
				aggregation_method, value, event_count, calculated_at
			)
			SELECT $1, s.customer_account_id, s.id, $2,
				'2026-09-05T00:00:00.000Z', '2026-09-06T00:00:00.000Z',
				'{}'::jsonb, 'tenant', 'sum', 18, 18, now()
			FROM subscriptions s
			WHERE s.tenant_id = $1 AND s.id = $3
			`,
			[tenantA, metricId, subscriptionId],
		);

		const queued = await api(alice, tenantA).post(
			`/billing-periods/${periodId}/invoice`,
		);
		expect(queued.status).toBe(202);
		expect(queued.body.status).toBe("queued");
		expect(typeof queued.body.jobId).toBe("string");

		const invoice = await waitForInvoice();
		invoiceId = invoice.id as string;
		expect(invoice).toMatchObject({
			status: "open",
			currency: "USD",
			subtotal: "52.04",
			discountTotal: "0",
			taxTotal: "0",
			total: "52.04",
			amountPaid: "0",
			amountDue: "52.04",
			billingPeriodId: periodId,
			billingProfile: {
				displayName: "Initech",
				email: "billing@initech.test",
			},
		});
		expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-000001$/);
		expect(invoice.issuedAt).toBeTruthy();
		expect(invoice.dueAt).toBeTruthy();

		const period = await api(alice, tenantA).get(
			`/billing-periods/${periodId}`,
		);
		expect(period.status).toBe(200);
		expect(period.body.status).toBe("invoiced");
		expect(period.body.completedAt).toBeTruthy();

		const repeat = await api(alice, tenantA).post(
			`/billing-periods/${periodId}/invoice`,
		);
		expect(repeat.status).toBe(202);
		expect(repeat.body.status).toBe("existing");
		expect(repeat.body.invoice.id).toBe(invoiceId);

		const count = await dataSource.query(
			"SELECT COUNT(*)::int AS count FROM invoices WHERE tenant_id = $1",
			[tenantA],
		);
		expect(count[0].count).toBe(1);
	});

	it("serializes concurrent generation into one invoice", async () => {
		const period = await api(alice, tenantA).post("/billing-periods").send({
			subscriptionId,
			periodStart: "2026-10-01T00:00:00.000Z",
			periodEnd: "2026-11-01T00:00:00.000Z",
		});
		expect(period.status).toBe(201);

		const billing = app.get(BillingService);
		const [first, second] = await Promise.all([
			billing.generateInvoice(tenantA, period.body.id),
			billing.generateInvoice(tenantA, period.body.id),
		]);
		expect(first.id).toBe(second.id);
		expect(first.invoiceNumber).toMatch(/^INV-\d{4}-000002$/);

		const count = await dataSource.query(
			"SELECT COUNT(*)::int AS count FROM invoices WHERE tenant_id = $1 AND billing_period_id = $2",
			[tenantA, period.body.id],
		);
		expect(count[0].count).toBe(1);
	});

	it("returns invoice lines with computed metered usage", async () => {
		const lines = await api(alice, tenantA).get(`/invoices/${invoiceId}/lines`);
		expect(lines.status).toBe(200);
		expect(lines.body).toHaveLength(3);
		const byType = new Map(
			(lines.body as Array<{ lineType: string }>).map((line) => [
				line.lineType,
				line,
			]),
		);
		expect(byType.get("flat")).toMatchObject({
			quantity: "1",
			unitPrice: "49.99",
			amount: "49.99",
		});
		expect(byType.get("per_unit")).toMatchObject({
			quantity: "3",
			unitPrice: "0.25",
			amount: "0.75",
		});
		expect(byType.get("metered")).toMatchObject({
			quantity: "13",
			unitPrice: "0.1",
			amount: "1.3",
			metadata: {
				measured: "18",
				included: "5",
			},
		});

		const calculation = await dataSource.query(
			"SELECT subtotal, total, status FROM billing_calculations WHERE tenant_id = $1 AND billing_period_id = $2",
			[tenantA, periodId],
		);
		expect(calculation).toHaveLength(1);
		expect(calculation[0]).toMatchObject({
			subtotal: "52.0400",
			total: "52.0400",
			status: "completed",
		});
	});

	it("lists and isolates invoices by tenant", async () => {
		const listed = await api(alice, tenantA).get("/invoices?status=open");
		expect(listed.status).toBe(200);
		expect(listed.body).toHaveLength(2);
		expect(
			(listed.body as Array<{ id: string }>).map((invoice) => invoice.id),
		).toContain(invoiceId);

		const periodInvoice = await api(alice, tenantA).get(
			`/billing-periods/${periodId}/invoice`,
		);
		expect(periodInvoice.status).toBe(200);
		expect(periodInvoice.body.id).toBe(invoiceId);

		const forbidden = await api(bob, tenantB).get(`/invoices/${invoiceId}`);
		expect(forbidden.status).toBe(404);

		const otherList = await api(bob, tenantB).get("/invoices");
		expect(otherList.status).toBe(200);
		expect(otherList.body).toHaveLength(0);
	});

	async function currentPlanId(): Promise<string> {
		const plans = await dataSource.query(
			"SELECT id FROM plans WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1",
			[tenantA],
		);
		return plans[0].id as string;
	}

	async function createPrice(planId: string, input: Record<string, unknown>) {
		const response = await api(alice, tenantA)
			.post(`/plans/${planId}/prices`)
			.send({
				currency: "USD",
				billingInterval: "month",
				...input,
			});
		expect(response.status).toBe(201);
		return response.body;
	}

	function attach(priceId: string, extra: Record<string, unknown>) {
		return api(alice, tenantA)
			.post(`/subscriptions/${subscriptionId}/items`)
			.send({ priceId, ...extra });
	}

	async function waitForInvoice(): Promise<Record<string, unknown>> {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const response = await api(alice, tenantA).get(
				`/billing-periods/${periodId}/invoice`,
			);
			if (response.status === 200) {
				return response.body as Record<string, unknown>;
			}
			await delay(50);
		}
		throw new Error("The invoice was not generated in time.");
	}
});
