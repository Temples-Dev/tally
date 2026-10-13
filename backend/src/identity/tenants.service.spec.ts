import { ConflictException } from "@nestjs/common";

import type { AuditService } from "./audit.service";
import type { Tenant } from "./entities/tenant.entity";
import { TenantsService } from "./tenants.service";

describe("TenantsService", () => {
	const tenants = { findOneBy: jest.fn() };
	const audit = { record: jest.fn() };
	let manager: Record<string, jest.Mock>;
	let dataSource: { transaction: jest.Mock };
	let service: TenantsService;

	beforeEach(() => {
		jest.clearAllMocks();
		manager = {
			getRepository: jest.fn().mockImplementation(() => ({
				create: jest.fn().mockImplementation((input: unknown) => input),
				save: jest
					.fn()
					.mockImplementation((input: unknown) =>
						Promise.resolve({ ...(input as object), id: "tenant-1" }),
					),
			})),
		};
		dataSource = {
			transaction: jest
				.fn()
				.mockImplementation((work: (manager: unknown) => unknown) =>
					work(manager),
				),
		};
		service = new TenantsService(
			dataSource as never,
			tenants as never,
			audit as unknown as AuditService,
		);
	});

	it("creates a tenant with the caller as owner in one transaction", async () => {
		const tenant = (await service.createTenant({
			name: "Acme Corp",
			externalIdentityId: "user-1",
		})) as Tenant & { slug?: string };

		expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		expect(tenant.slug).toBe("acme-corp");
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "tenant.created",
				resourceId: "tenant-1",
			}),
			manager,
		);
	});

	it("maps slug conflicts to a conflict error", async () => {
		const duplicate = Object.assign(new Error("duplicate"), { code: "23505" });
		dataSource.transaction.mockRejectedValue(duplicate);

		await expect(
			service.createTenant({ name: "Acme", externalIdentityId: "user-1" }),
		).rejects.toThrow(ConflictException);
	});
});
