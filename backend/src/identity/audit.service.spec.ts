import { AuditService, scrubMetadata } from "./audit.service";
import { ActorType } from "./enums";

describe("scrubMetadata", () => {
	it("redacts secret-bearing keys at any depth", () => {
		expect(
			scrubMetadata({
				action: "tenant.created",
				apiSecret: "shh",
				nested: { password: "shh", safe: "keep" },
			}),
		).toEqual({
			action: "tenant.created",
			apiSecret: "[redacted]",
			nested: { password: "[redacted]", safe: "keep" },
		});
	});
});

describe("AuditService", () => {
	it("persists a scrubbed record with null defaults", async () => {
		const save = jest
			.fn()
			.mockImplementation((record: unknown) => Promise.resolve(record));
		const repository = {
			create: jest.fn().mockImplementation((input: unknown) => input),
			save,
		};
		const service = new AuditService(repository as never);

		await service.record({
			actorType: ActorType.HUMAN,
			actorId: "user-1",
			action: "tenant.created",
			resourceType: "tenant",
			resourceId: "tenant-1",
			metadata: { token: "shh" },
		});

		expect(save).toHaveBeenCalledTimes(1);
		const saved = save.mock.calls[0][0] as Record<string, unknown>;
		expect(saved).toMatchObject({
			tenantId: null,
			actorId: "user-1",
			metadata: { token: "[redacted]" },
		});
	});

	it("recordSafely never rejects", async () => {
		const repository = {
			create: jest.fn().mockReturnValue({}),
			save: jest.fn().mockRejectedValue(new Error("db down")),
		};
		const service = new AuditService(repository as never);

		await expect(
			(async () => {
				service.recordSafely({
					actorType: ActorType.SYSTEM,
					action: "test",
					resourceType: "test",
					resourceId: "test",
				});
				await new Promise((resolve) => setTimeout(resolve, 10));
			})(),
		).resolves.toBeUndefined();
	});
});
