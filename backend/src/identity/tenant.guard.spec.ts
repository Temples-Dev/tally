import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

import type { AuditService } from "./audit.service";
import { MemberRole, MemberStatus, TenantStatus } from "./enums";
import type { TenantMembersService } from "./tenant-members.service";
import { TenantGuard } from "./tenant.guard";

function executionContextWith(
	headers: Record<string, string | undefined>,
	identityId = "user-1",
) {
	const request = { headers, identityId } as never;
	return {
		getHandler: () => "handler",
		getClass: () => "class",
		switchToHttp: () => ({ getRequest: () => request }),
		getRequest: () => request,
	} as never;
}

function membership(overrides: Record<string, unknown> = {}) {
	return {
		member: {
			role: MemberRole.DEVELOPER,
			status: MemberStatus.ACTIVE,
			...overrides,
		},
		tenant: { status: TenantStatus.ACTIVE, ...overrides },
	} as never;
}

describe("TenantGuard", () => {
	let guard: TenantGuard;
	let reflector: jest.Mocked<Reflector>;
	let memberships: jest.Mocked<TenantMembersService>;
	let audit: jest.Mocked<AuditService>;

	beforeEach(() => {
		reflector = {
			getAllAndOverride: jest.fn().mockReturnValue(undefined),
		} as never;
		memberships = { findActiveMembership: jest.fn() } as never;
		audit = { recordSafely: jest.fn() } as never;
		guard = new TenantGuard(reflector, memberships, audit);
	});

	it("allows an active member and records nothing", async () => {
		memberships.findActiveMembership.mockResolvedValue(membership());
		const context = executionContextWith({ "x-tenant-id": "tenant-1" });

		await expect(guard.canActivate(context)).resolves.toBe(true);
		expect(memberships.findActiveMembership).toHaveBeenCalledWith(
			"user-1",
			"tenant-1",
		);
		expect(audit.recordSafely).not.toHaveBeenCalled();
	});

	it("conceals unknown tenants as not found and audits the denial", async () => {
		memberships.findActiveMembership.mockResolvedValue(null);
		const context = executionContextWith({ "x-tenant-id": "tenant-unknown" });

		await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
		expect(audit.recordSafely).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "tenant.access-denied",
				resourceId: "tenant-unknown",
			}),
		);
	});

	it("rejects suspended tenants", async () => {
		memberships.findActiveMembership.mockResolvedValue(
			membership({ status: TenantStatus.SUSPENDED }),
		);
		await expect(
			guard.canActivate(executionContextWith({ "x-tenant-id": "tenant-1" })),
		).rejects.toThrow(ForbiddenException);
	});

	it("rejects missing tenant selection", async () => {
		await expect(guard.canActivate(executionContextWith({}))).rejects.toThrow(
			ForbiddenException,
		);
		expect(memberships.findActiveMembership).not.toHaveBeenCalled();
	});

	it("enforces required roles", async () => {
		(reflector.getAllAndOverride as jest.Mock).mockReturnValue([
			MemberRole.OWNER,
		]);
		memberships.findActiveMembership.mockResolvedValue(membership());
		await expect(
			guard.canActivate(executionContextWith({ "x-tenant-id": "tenant-1" })),
		).rejects.toThrow(ForbiddenException);
	});
});
