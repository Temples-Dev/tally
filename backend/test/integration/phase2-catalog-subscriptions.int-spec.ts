import { createHmac } from "node:crypto";

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

describe("Phase 2 catalog and subscriptions (integration)", () => {
	let container: StartedPostgreSqlContainer;
	let app: INestApplication;
	let dataSource: DataSource;

	const alice = mintToken("alice");
	const bob = mintToken("bob");
	const carol = mintToken("carol");

	let tenantA = "";
	let tenantB = "";

	beforeAll(async () => {
		container = await new PostgreSqlContainer("postgres:16-alpine").start();

		process.env.NODE_ENV = "test";
		process.env.DATABASE_URL = container.getConnectionUri();
		process.env.CORS_ORIGINS = "http://localhost:5173";
		process.env.AUTH_JWT_SECRET = JWT_SECRET;

		const { AppModule } = await import("../../src/app.module");
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule],
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
		// Carol watches tenant A without managing it.
		await dataSource.getRepository(TenantMember).save({
			tenantId: tenantA,
			externalIdentityId: "carol",
			role: MemberRole.VIEWER,
			status: MemberStatus.ACTIVE,
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

	async function ensureDefinition(
		tenant: string,
		identity: string,
		input: {
			code: string;
			name: string;
			valueType: string;
			defaultValue?: unknown;
			validationSchema?: Record<string, unknown>;
		},
	): Promise<{ id: string }> {
		const created = await api(identity, tenant)
			.post("/entitlement-definitions")
			.send(input);
		if (created.status === 201) {
			return created.body;
		}
		const list = await api(identity, tenant).get("/entitlement-definitions");
		const existing = (list.body as Array<{ id: string; code: string }>).find(
			(definition) => definition.code === input.code,
		);
		if (existing === undefined) {
			throw new Error(`Could not create or find definition ${input.code}`);
		}
		return existing;
	}

	async function createPublishedCatalog(
		tenant: string,
		identity: string,
		input: {
			productCode: string;
			definitionCode: string;
			valueType: string;
			value: unknown;
			defaultValue?: unknown;
			validationSchema?: Record<string, unknown>;
		},
	): Promise<{
		productId: string;
		planId: string;
		versionId: string;
	}> {
		const product = await api(identity, tenant)
			.post("/products")
			.send({ code: input.productCode, name: input.productCode });
		expect(product.status).toBe(201);
		const plan = await api(identity, tenant)
			.post("/plans")
			.send({
				productId: product.body.id,
				code: `${input.productCode}-plan`,
				name: `${input.productCode} plan`,
			});
		expect(plan.status).toBe(201);
		const version = await api(identity, tenant)
			.post(`/plans/${plan.body.id}/versions`)
			.send({});
		expect(version.status).toBe(201);
		await ensureDefinition(tenant, identity, {
			code: input.definitionCode,
			name: input.definitionCode,
			valueType: input.valueType,
			defaultValue: input.defaultValue,
			validationSchema: input.validationSchema,
		});
		const grant = await api(identity, tenant)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/entitlements`)
			.send({ definitionCode: input.definitionCode, value: input.value });
		expect(grant.status).toBe(200);
		const published = await api(identity, tenant)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/publish`)
			.send({});
		expect(published.status).toBe(200);
		return {
			productId: product.body.id,
			planId: plan.body.id,
			versionId: version.body.id,
		};
	}

	async function createCustomer(
		tenant: string,
		identity: string,
		displayName: string,
	): Promise<string> {
		const customer = await api(identity, tenant)
			.post("/customers")
			.send({ displayName });
		expect(customer.status).toBe(201);
		return customer.body.id as string;
	}

	it("manages the catalog with owner rights and blocks viewers", async () => {
		const product = await api(alice, tenantA)
			.post("/products")
			.send({ code: "CAT", name: "Catalog" });
		expect(product.status).toBe(201);

		const viewerCreate = await api(carol, tenantA)
			.post("/products")
			.send({ code: "SMS", name: "Texts" });
		expect(viewerCreate.status).toBe(403);
		expect(viewerCreate.body.code).toBe("FORBIDDEN");

		const duplicate = await api(alice, tenantA)
			.post("/products")
			.send({ code: "CAT", name: "Duplicate" });
		expect(duplicate.status).toBe(409);

		const plan = await api(alice, tenantA)
			.post("/plans")
			.send({ productId: product.body.id, code: "starter", name: "Starter" });
		expect(plan.status).toBe(201);

		const version = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions`)
			.send({});
		expect(version.status).toBe(201);
		expect(version.body.versionNumber).toBe(1);

		const definition = await api(alice, tenantA)
			.post("/entitlement-definitions")
			.send({
				code: "catalog.projects",
				name: "Project limit",
				valueType: "integer",
				defaultValue: 5,
			});
		expect(definition.status).toBe(201);

		const grant = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/entitlements`)
			.send({ definitionCode: "catalog.projects", value: 25 });
		expect(grant.status).toBe(200);

		const badGrant = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/entitlements`)
			.send({ definitionCode: "catalog.projects", value: "unlimited" });
		expect(badGrant.status).toBe(422);

		const unknownField = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/entitlements`)
			.send({
				definitionCode: "catalog.projects",
				value: 30,
				unexpected: true,
			});
		expect(unknownField.status).toBe(400);

		const published = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/publish`)
			.send({});
		expect(published.status).toBe(200);
		expect(published.body.status).toBe("published");

		const frozen = await api(alice, tenantA)
			.post(`/plans/${plan.body.id}/versions/${version.body.id}/entitlements`)
			.send({ definitionCode: "catalog.projects", value: 50 });
		expect(frozen.status).toBe(409);
	});

	it("runs the subscription lifecycle and records real from/to history", async () => {
		const catalog = await createPublishedCatalog(tenantA, alice, {
			productCode: "LIFECYCLE",
			definitionCode: "limits.projects",
			valueType: "integer",
			value: 25,
		});
		const customerId = await createCustomer(
			tenantA,
			alice,
			"Lifecycle Billing",
		);

		const created = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customerId,
			planVersionId: catalog.versionId,
			trialDays: 14,
		});
		expect(created.status).toBe(201);
		expect(created.body.status).toBe("trialing");
		expect(created.body.productId).toBe(catalog.productId);
		const subscriptionId = created.body.id as string;

		const evaluated = await api(alice, tenantA).get(
			`/tenants/${tenantA}/entitlements/limits.projects`,
		);
		expect(evaluated.status).toBe(200);
		expect(evaluated.body).toMatchObject({
			allowed: true,
			value: 25,
			reason: "PLAN_BASELINE",
		});

		const resumed = await api(alice, tenantA)
			.post(`/subscriptions/${subscriptionId}/resume`)
			.send({});
		expect(resumed.status).toBe(200);
		expect(resumed.body.status).toBe("active");

		const cancelled = await api(alice, tenantA)
			.post(`/subscriptions/${subscriptionId}/cancel`)
			.send({ mode: "immediate", reason: "customer_requested" });
		expect(cancelled.status).toBe(200);
		expect(cancelled.body.status).toBe("cancelled");

		const denied = await api(alice, tenantA).get(
			`/tenants/${tenantA}/entitlements/limits.projects`,
		);
		expect(denied.body).toMatchObject({
			allowed: false,
			reason: "NOT_SUBSCRIBED",
		});

		const noResurrection = await api(alice, tenantA)
			.post(`/subscriptions/${subscriptionId}/resume`)
			.send({});
		expect(noResurrection.status).toBe(409);

		const history = await api(alice, tenantA).get(
			`/subscriptions/${subscriptionId}/history`,
		);
		expect(history.status).toBe(200);
		const changes = history.body as Array<{
			changeType: string;
			previousConfiguration: { status?: string };
			newConfiguration: { status?: string };
		}>;
		const conversion = changes.find(
			(change) => change.changeType === "trial_converted",
		);
		expect(conversion).toMatchObject({
			previousConfiguration: { status: "trialing" },
			newConfiguration: { status: "active" },
		});
		const cancellation = changes.find(
			(change) => change.changeType === "cancelled",
		);
		expect(cancellation).toMatchObject({
			previousConfiguration: { status: "active" },
			newConfiguration: { status: "cancelled" },
		});
	});

	it("allows only one active or trialing subscription per product", async () => {
		const catalog = await createPublishedCatalog(tenantA, alice, {
			productCode: "CARDINALITY",
			definitionCode: "limits.seats",
			valueType: "integer",
			value: 5,
		});
		const customerId = await createCustomer(
			tenantA,
			alice,
			"Cardinality Billing",
		);

		const first = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customerId,
			planVersionId: catalog.versionId,
		});
		expect(first.status).toBe(201);

		const conflicting = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customerId,
			planVersionId: catalog.versionId,
		});
		expect(conflicting.status).toBe(409);

		const cancelled = await api(alice, tenantA)
			.post(`/subscriptions/${first.body.id}/cancel`)
			.send({ mode: "immediate", reason: "test_cleanup" });
		expect(cancelled.status).toBe(200);

		const replacement = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customerId,
			planVersionId: catalog.versionId,
		});
		expect(replacement.status).toBe(201);
	});

	it("resolves entitlements independently across products", async () => {
		const projects = await createPublishedCatalog(tenantA, alice, {
			productCode: "PROJ",
			definitionCode: "multi.projects",
			valueType: "integer",
			value: 25,
		});
		const seats = await createPublishedCatalog(tenantA, alice, {
			productCode: "SEATS",
			definitionCode: "multi.seats",
			valueType: "integer",
			value: 10,
		});
		const customerId = await createCustomer(
			tenantA,
			alice,
			"Multi Product Billing",
		);

		for (const catalog of [projects, seats]) {
			const subscription = await api(alice, tenantA)
				.post("/subscriptions")
				.send({
					customerAccountId: customerId,
					planVersionId: catalog.versionId,
				});
			expect(subscription.status).toBe(201);
		}

		const projectsDecision = await api(alice, tenantA).get(
			`/tenants/${tenantA}/entitlements/multi.projects`,
		);
		expect(projectsDecision.body).toMatchObject({
			allowed: true,
			value: 25,
		});
		const seatsDecision = await api(alice, tenantA).get(
			`/tenants/${tenantA}/entitlements/multi.seats`,
		);
		expect(seatsDecision.body).toMatchObject({
			allowed: true,
			value: 10,
		});

		const conflicting = await createPublishedCatalog(tenantA, alice, {
			productCode: "PROJ2",
			definitionCode: "multi.projects",
			valueType: "integer",
			value: 99,
		});
		await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customerId,
			planVersionId: conflicting.versionId,
		});
		const ambiguous = await api(alice, tenantA).get(
			`/tenants/${tenantA}/entitlements/multi.projects`,
		);
		expect(ambiguous.body).toMatchObject({
			allowed: false,
			reason: "AMBIGUOUS_SUBSCRIPTIONS",
		});
	});

	it("schedules plan changes for period end and rejects cross-product changes", async () => {
		const catalog = await createPublishedCatalog(tenantA, alice, {
			productCode: "PLANCHANGE",
			definitionCode: "changes.limit",
			valueType: "integer",
			value: 1,
		});
		const customerId = await createCustomer(
			tenantA,
			alice,
			"Plan Change Billing",
		);
		const subscription = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customerId,
			planVersionId: catalog.versionId,
		});
		const subscriptionId = subscription.body.id as string;

		const second = await api(alice, tenantA)
			.post(`/plans/${catalog.planId}/versions`)
			.send({});
		await api(alice, tenantA)
			.post(`/plans/${catalog.planId}/versions/${second.body.id}/publish`)
			.send({});

		const scheduled = await api(alice, tenantA)
			.post(`/subscriptions/${subscriptionId}/plan-changes`)
			.send({
				targetPlanVersionId: second.body.id,
				effectiveMode: "period_end",
			});
		expect(scheduled.status).toBe(200);

		const history = await api(alice, tenantA).get(
			`/subscriptions/${subscriptionId}/history`,
		);
		const pending = (
			history.body as Array<{
				changeType: string;
				status: string;
				previousConfiguration: { planVersionId?: string };
				newConfiguration: { planVersionId?: string };
			}>
		).find((change) => change.changeType === "plan_change_requested");
		expect(pending?.status).toBe("pending");
		expect(pending?.previousConfiguration.planVersionId).toBe(
			catalog.versionId,
		);
		expect(pending?.newConfiguration.planVersionId).toBe(second.body.id);

		const otherProduct = await createPublishedCatalog(tenantA, alice, {
			productCode: "OTHER",
			definitionCode: "other.limit",
			valueType: "integer",
			value: 2,
		});
		const crossProduct = await api(alice, tenantA)
			.post(`/subscriptions/${subscriptionId}/plan-changes`)
			.send({
				targetPlanVersionId: otherProduct.versionId,
				effectiveMode: "immediate",
			});
		expect(crossProduct.status).toBe(422);

		const cleanup = await api(alice, tenantA)
			.post(`/subscriptions/${subscriptionId}/cancel`)
			.send({ mode: "immediate", reason: "test_cleanup" });
		expect(cleanup.status).toBe(200);
	});

	it("applies enum overrides and rejects overlapping overrides", async () => {
		const catalog = await createPublishedCatalog(tenantA, alice, {
			productCode: "ENUM",
			definitionCode: "support.tier",
			valueType: "enum",
			value: "premium",
			validationSchema: { enum: ["standard", "premium"] },
		});
		const customerId = await createCustomer(tenantA, alice, "Enum Billing");
		const subscription = await api(alice, tenantA).post("/subscriptions").send({
			customerAccountId: customerId,
			planVersionId: catalog.versionId,
		});
		const subscriptionId = subscription.body.id as string;

		const baseline = await api(alice, tenantA).get(
			`/tenants/${tenantA}/entitlements/support.tier`,
		);
		expect(baseline.body).toMatchObject({
			allowed: true,
			value: "premium",
			reason: "PLAN_BASELINE",
		});

		const override = await api(alice, tenantA)
			.post("/entitlement-overrides")
			.send({
				subscriptionId,
				definitionCode: "support.tier",
				value: "standard",
				reason: "Support pilot",
				effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
			});
		expect(override.status).toBe(201);

		const evaluated = await api(alice, tenantA).get(
			`/tenants/${tenantA}/entitlements/support.tier`,
		);
		expect(evaluated.body).toMatchObject({
			allowed: true,
			value: "standard",
			reason: "OVERRIDE",
		});

		const overlapping = await api(alice, tenantA)
			.post("/entitlement-overrides")
			.send({
				subscriptionId,
				definitionCode: "support.tier",
				value: "premium",
				reason: "Overlap",
				effectiveFrom: new Date().toISOString(),
			});
		expect(overlapping.status).toBe(409);

		const invalidInterval = await api(alice, tenantA)
			.post("/entitlement-overrides")
			.send({
				subscriptionId,
				definitionCode: "support.tier",
				value: "premium",
				reason: "Bad interval",
				effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
				effectiveUntil: new Date().toISOString(),
			});
		expect(invalidInterval.status).toBe(422);
	});

	it("isolates tenants across catalog and subscription reads", async () => {
		const stranger = await api(bob, tenantA).get("/tenants");
		expect(stranger.status).toBe(404);

		const otherTenantProducts = await api(bob, tenantB).get("/products");
		expect(otherTenantProducts.status).toBe(200);
		expect(otherTenantProducts.body).toEqual([]);

		const foreignPlan = await api(bob, tenantB).get("/plans");
		expect(foreignPlan.status).toBe(200);
		expect(foreignPlan.body).toEqual([]);
	});
});
