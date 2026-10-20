import { createHmac, randomBytes } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
const PAYSTACK_SECRET = "sk_test_integrationpaystacksecret";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");

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

function webhookSignature(rawBody: string, secret = PAYSTACK_SECRET): string {
	return createHmac("sha512", secret).update(rawBody).digest("hex");
}

describe("Paystack payments (integration)", () => {
	let container: StartedPostgreSqlContainer;
	let app: INestApplication;
	let dataSource: DataSource;
	let paystackServer: Server;
	let initializeCalls = 0;
	let providerTransactionId = 9000;

	const alice = mintToken("alice-payments");
	const bob = mintToken("bob-payments");

	let tenantA = "";
	let tenantB = "";
	let invoiceA = "";
	let invoiceB = "";
	let paymentA = "";
	let paymentReference = "";
	let processedEventId = "";

	beforeAll(async () => {
		container = await new PostgreSqlContainer("postgres:16-alpine").start();
		paystackServer = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf8");
				if (req.method === "POST" && req.url === "/transaction/initialize") {
					initializeCalls += 1;
					const body = JSON.parse(raw) as {
						email: string;
						reference: string;
					};
					if (body.email === "fail@paystack.test") {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(
							JSON.stringify({
								status: false,
								message: "Test provider rejection.",
							}),
						);
						return;
					}
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							status: true,
							message: "Authorization URL created",
							data: {
								authorization_url: `https://checkout.paystack.test/${body.reference}`,
								access_code: "test-access-code",
								reference: body.reference,
							},
						}),
					);
					return;
				}
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: false, message: "Not found" }));
			});
		});
		await new Promise<void>((resolve) => {
			paystackServer.listen(0, "127.0.0.1", resolve);
		});
		const address = paystackServer.address() as AddressInfo;

		process.env.NODE_ENV = "test";
		process.env.DATABASE_URL = container.getConnectionUri();
		process.env.CORS_ORIGINS = "http://localhost:5173";
		process.env.AUTH_JWT_SECRET = JWT_SECRET;
		process.env.JOB_POLL_INTERVAL_MS = "50";
		process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = ENCRYPTION_KEY;
		process.env.PAYSTACK_BASE_URL = `http://127.0.0.1:${address.port}`;

		const { AppModule } = await import("../../src/app.module");
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule, JobRunnerModule],
		}).compile();

		app = moduleRef.createNestApplication({ logger: false, rawBody: true });
		configureApp(app);
		await app.init();

		dataSource = moduleRef.get(DataSource);
		await dataSource.runMigrations();

		tenantA = await createTenant(alice, "Payments Corp");
		tenantB = await createTenant(bob, "Payments Beta");
		const customerA = await api(alice, tenantA)
			.post("/customers")
			.send({ displayName: "Initech", email: "pay@initech.test" });
		expect(customerA.status).toBe(201);
		const customerB = await api(bob, tenantB)
			.post("/customers")
			.send({ displayName: "Beta Co", email: "pay@beta.test" });
		expect(customerB.status).toBe(201);
		const failingCustomer = await api(alice, tenantA)
			.post("/customers")
			.send({ displayName: "Failure Co", email: "fail@paystack.test" });
		expect(failingCustomer.status).toBe(201);

		invoiceA = await createInvoice(
			tenantA,
			customerA.body.id as string,
			"INV-2026-900001",
			"52.04",
			"pay@initech.test",
		);
		invoiceB = await createInvoice(
			tenantB,
			customerB.body.id as string,
			"INV-2026-900002",
			"20.00",
			"pay@beta.test",
		);
		await createInvoice(
			tenantA,
			failingCustomer.body.id as string,
			"INV-2026-900003",
			"10.00",
			"fail@paystack.test",
		);
	});

	afterAll(async () => {
		await app?.close();
		await container?.stop();
		await new Promise<void>((resolve, reject) => {
			paystackServer?.close((error) => {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});
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

	async function createTenant(token: string, name: string): Promise<string> {
		const response = await request(app.getHttpServer())
			.post("/v1/tenants")
			.set("Authorization", `Bearer ${token}`)
			.send({ name });
		expect(response.status).toBe(201);
		return response.body.id as string;
	}

	async function createInvoice(
		tenantId: string,
		customerId: string,
		invoiceNumber: string,
		amount: string,
		email: string,
	): Promise<string> {
		const rows = (await dataSource.query(
			`
			INSERT INTO invoices (
				tenant_id, customer_account_id, invoice_number,
				billing_profile_snapshot, currency, status, issued_at, due_at,
				subtotal, discount_total, tax_total, total, amount_paid,
				amount_credited, amount_due
			)
			VALUES (
				$1, $2, $3, $4::jsonb, 'USD', 'open', now(), now() + interval '14 days',
				$5, 0, 0, $5, 0, 0, $5
			)
			RETURNING id
			`,
			[
				tenantId,
				customerId,
				invoiceNumber,
				JSON.stringify({ email, displayName: email }),
				amount,
			],
		)) as Array<{ id: string }>;
		return rows[0]?.id ?? "";
	}

	async function waitForEvent(
		processingStatus: string,
	): Promise<Record<string, unknown>> {
		for (let attempt = 0; attempt < 120; attempt += 1) {
			const rows = (await dataSource.query(
				`
				SELECT id, processing_status, error_code
				FROM payment_webhook_events
				WHERE tenant_id = $1
				ORDER BY received_at DESC
				LIMIT 1
				`,
				[tenantA],
			)) as Array<Record<string, unknown>>;
			if (rows[0]?.processing_status === processingStatus) {
				return rows[0];
			}
			await delay(50);
		}
		throw new Error(`Webhook event did not become ${processingStatus}.`);
	}

	it("connects an encrypted per-tenant Paystack account", async () => {
		const configured = await api(alice, tenantA)
			.post("/payment-provider-accounts")
			.send({
				secretKey: PAYSTACK_SECRET,
				publicKey: "pk_test_integrationpublickey",
				defaultCallbackUrl: "https://app.tally.test/payments/return",
			});
		expect(configured.status).toBe(201);
		expect(configured.body).toMatchObject({
			provider: "paystack",
			status: "active",
			secretKeyLast4: "cret",
			publicKey: "pk_test_integrationpublickey",
		});
		expect(JSON.stringify(configured.body)).not.toContain(PAYSTACK_SECRET);

		const stored = (await dataSource.query(
			`
			SELECT encrypted_secret_key, secret_key_iv, secret_key_tag
			FROM payment_provider_accounts WHERE tenant_id = $1
			`,
			[tenantA],
		)) as Array<Record<string, unknown>>;
		expect(stored[0]?.encrypted_secret_key).not.toBe(PAYSTACK_SECRET);
		expect(stored[0]?.secret_key_iv).toBeTruthy();
		expect(stored[0]?.secret_key_tag).toBeTruthy();

		const configuredB = await api(bob, tenantB)
			.post("/payment-provider-accounts")
			.send({ secretKey: "sk_test_betanothersecret" });
		expect(configuredB.status).toBe(201);

		const list = await api(alice, tenantA).get("/payment-provider-accounts");
		expect(list.status).toBe(200);
		expect(list.body).toHaveLength(1);
	});

	it("initiates a checkout idempotently and rejects a reused key", async () => {
		const first = await api(alice, tenantA)
			.post(`/invoices/${invoiceA}/payments`)
			.set("Idempotency-Key", "payment-a-001")
			.send({ returnUrl: "https://app.tally.test/paid" });
		expect(first.status).toBe(201);
		expect(first.body).toMatchObject({
			invoiceId: invoiceA,
			provider: "paystack",
			amount: "52.04",
			currency: "USD",
			status: "requires_action",
		});
		expect(first.body.checkoutUrl).toMatch(
			/^https:\/\/checkout\.paystack\.test\/pay_/,
		);
		expect(initializeCalls).toBe(1);
		paymentA = first.body.id as string;
		paymentReference = first.body.providerReference as string;

		const repeated = await api(alice, tenantA)
			.post(`/invoices/${invoiceA}/payments`)
			.set("Idempotency-Key", "payment-a-001")
			.send({});
		expect(repeated.status).toBe(201);
		expect(repeated.body.id).toBe(paymentA);
		expect(initializeCalls).toBe(1);

		const reused = await api(alice, tenantA)
			.post(`/invoices/${invoiceB}/payments`)
			.set("Idempotency-Key", "payment-a-001")
			.send({});
		expect(reused.status).toBe(409);

		const missingInvoice = await api(alice, tenantA)
			.post("/invoices/00000000-0000-4000-8000-000000000000/payments")
			.send({});
		expect(missingInvoice.status).toBe(404);
	});

	it("records provider initiation failures without creating a checkout", async () => {
		const rows = (await dataSource.query(
			"SELECT id FROM invoices WHERE tenant_id = $1 AND invoice_number = $2",
			[tenantA, "INV-2026-900003"],
		)) as Array<{ id: string }>;
		const response = await api(alice, tenantA)
			.post(`/invoices/${rows[0]?.id}/payments`)
			.send({});
		expect(response.status).toBe(500);
		const failed = (await dataSource.query(
			`
			SELECT status, failure_code FROM payment_attempts
			WHERE tenant_id = $1 AND invoice_id = $2
			ORDER BY created_at DESC LIMIT 1
			`,
			[tenantA, rows[0]?.id],
		)) as Array<Record<string, unknown>>;
		expect(failed[0]).toMatchObject({
			status: "failed",
			failure_code: "PROVIDER_HTTP_400",
		});
	});

	it("rejects unsigned and invalid webhook payloads", async () => {
		const payload = JSON.stringify({
			event: "charge.success",
			data: {
				id: 9001,
				reference: paymentReference,
				status: "success",
				amount: 5204,
				currency: "USD",
				paid_at: new Date().toISOString(),
			},
		});
		const unsigned = await request(app.getHttpServer())
			.post("/v1/webhooks/payments/paystack")
			.set("Content-Type", "application/json")
			.send(payload);
		expect(unsigned.status).toBe(401);

		const invalid = await request(app.getHttpServer())
			.post("/v1/webhooks/payments/paystack")
			.set("Content-Type", "application/json")
			.set("x-paystack-signature", "00".repeat(64))
			.send(payload);
		expect(invalid.status).toBe(401);
	});

	it("verifies a signed webhook and settles the invoice once", async () => {
		providerTransactionId += 1;
		const payload = JSON.stringify({
			event: "charge.success",
			data: {
				id: providerTransactionId,
				reference: paymentReference,
				status: "success",
				amount: 5204,
				currency: "USD",
				paid_at: new Date().toISOString(),
				gateway_response: "Successful",
				channel: "card",
			},
		});
		const accepted = await request(app.getHttpServer())
			.post("/v1/webhooks/payments/paystack")
			.set("Content-Type", "application/json")
			.set("x-paystack-signature", webhookSignature(payload))
			.send(payload);
		expect(accepted.status).toBe(200);
		expect(accepted.body).toEqual({ received: true });

		const event = await waitForEvent("processed");
		processedEventId = event.id as string;
		expect(event.error_code).toBeNull();

		const payment = await api(alice, tenantA).get(`/payments/${paymentA}`);
		expect(payment.status).toBe(200);
		expect(payment.body.status).toBe("succeeded");

		const invoice = await api(alice, tenantA).get(`/invoices/${invoiceA}`);
		expect(invoice.status).toBe(200);
		expect(invoice.body).toMatchObject({
			status: "paid",
			amountPaid: "52.04",
			amountDue: "0",
		});

		const transactions = (await dataSource.query(
			`
			SELECT amount, currency, transaction_type
			FROM payment_transactions
			WHERE tenant_id = $1 AND invoice_id = $2
			`,
			[tenantA, invoiceA],
		)) as Array<Record<string, unknown>>;
		expect(transactions).toEqual([
			{ amount: "52.0400", currency: "USD", transaction_type: "payment" },
		]);
	});

	it("ignores a duplicate webhook delivery", async () => {
		const payload = JSON.stringify({
			event: "charge.success",
			data: {
				id: providerTransactionId,
				reference: paymentReference,
				status: "success",
				amount: 5204,
				currency: "USD",
				paid_at: new Date().toISOString(),
			},
		});
		const duplicate = await request(app.getHttpServer())
			.post("/v1/webhooks/payments/paystack")
			.set("Content-Type", "application/json")
			.set("x-paystack-signature", webhookSignature(payload))
			.send(payload);
		expect(duplicate.status).toBe(200);
		expect(duplicate.body).toEqual({ received: true, duplicate: true });

		const events = (await dataSource.query(
			"SELECT id FROM payment_webhook_events WHERE tenant_id = $1",
			[tenantA],
		)) as Array<{ id: string }>;
		expect(events).toHaveLength(1);
		expect(events[0]?.id).toBe(processedEventId);

		const invoices = (await dataSource.query(
			"SELECT amount_paid, amount_due FROM invoices WHERE id = $1",
			[invoiceA],
		)) as Array<Record<string, unknown>>;
		expect(invoices[0]).toMatchObject({
			amount_paid: "52.0400",
			amount_due: "0.0000",
		});
	});

	it("isolates payment records and invoices by tenant", async () => {
		const crossTenantPayment = await api(bob, tenantB).get(
			`/payments/${paymentA}`,
		);
		expect(crossTenantPayment.status).toBe(404);

		const crossTenantInvoice = await api(bob, tenantB)
			.post(`/invoices/${invoiceA}/payments`)
			.send({});
		expect(crossTenantInvoice.status).toBe(404);

		const ownInvoice = await api(bob, tenantB).get(`/invoices/${invoiceB}`);
		expect(ownInvoice.status).toBe(200);
	});
});
