import { createHmac } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
	PostgreSqlContainer,
	type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import request from "supertest";
import { DataSource } from "typeorm";

jest.setTimeout(60_000);

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

describe("Tenant isolation (integration)", () => {
	let container: StartedPostgreSqlContainer;
	let app: INestApplication;
	let dataSource: DataSource;

	const alice = mintToken("alice");
	const bob = mintToken("bob");

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
		await app.init();

		dataSource = moduleRef.get(DataSource);
		await dataSource.runMigrations();
	});

	afterAll(async () => {
		await app?.close();
		await container?.stop();
	});

	it("rejects tenant creation without a token", async () => {
		const response = await request(app.getHttpServer())
			.post("/tenants")
			.send({ name: "Nope" });

		expect(response.status).toBe(401);
		expect(response.body.code).toBe("UNAUTHENTICATED");
		expect(response.body.requestId).toBe(response.headers["x-correlation-id"]);
	});

	it("lets the owner in and keeps strangers out", async () => {
		const created = await request(app.getHttpServer())
			.post("/tenants")
			.set("Authorization", `Bearer ${alice}`)
			.send({ name: "Acme Corp" });

		expect(created.status).toBe(201);
		expect(created.body.slug).toBe("acme-corp");
		const tenantId = created.body.id as string;

		const ownerRead = await request(app.getHttpServer())
			.get(`/tenants/${tenantId}`)
			.set("Authorization", `Bearer ${alice}`)
			.set("x-tenant-id", tenantId);
		expect(ownerRead.status).toBe(200);
		expect(ownerRead.body.name).toBe("Acme Corp");

		const strangerRead = await request(app.getHttpServer())
			.get(`/tenants/${tenantId}`)
			.set("Authorization", `Bearer ${bob}`)
			.set("x-tenant-id", tenantId);
		expect(strangerRead.status).toBe(404);
		expect(strangerRead.body.code).toBe("NOT_FOUND");

		const auditRows = (await dataSource.query(
			"SELECT action, actor_id FROM audit_records WHERE tenant_id = $1",
			[tenantId],
		)) as Array<{ action: string; actor_id: string }>;
		expect(auditRows).toHaveLength(2);
		expect(auditRows).toContainEqual(
			expect.objectContaining({ action: "tenant.created", actor_id: "alice" }),
		);
		expect(auditRows).toContainEqual(
			expect.objectContaining({
				action: "tenant.access-denied",
				actor_id: "bob",
			}),
		);
	});

	it("rejects duplicate slugs and suspended tenants", async () => {
		const first = await request(app.getHttpServer())
			.post("/tenants")
			.set("Authorization", `Bearer ${alice}`)
			.send({ name: "Dupe Corp" });
		expect(first.status).toBe(201);

		const duplicate = await request(app.getHttpServer())
			.post("/tenants")
			.set("Authorization", `Bearer ${alice}`)
			.send({ name: "Dupe Corp" });
		expect(duplicate.status).toBe(409);
		expect(duplicate.body.code).toBe("CONFLICT");

		const tenantId = first.body.id as string;
		await dataSource.query(
			"UPDATE tenants SET status = 'suspended' WHERE id = $1",
			[tenantId],
		);

		const suspendedRead = await request(app.getHttpServer())
			.get(`/tenants/${tenantId}`)
			.set("Authorization", `Bearer ${alice}`)
			.set("x-tenant-id", tenantId);
		expect(suspendedRead.status).toBe(403);
		expect(suspendedRead.body.code).toBe("FORBIDDEN");
	});
});
