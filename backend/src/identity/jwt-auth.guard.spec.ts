import { createHmac } from "node:crypto";

import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Reflector } from "@nestjs/core";

import { JwtAuthGuard } from "./jwt-auth.guard";

const SECRET = "test-secret-with-enough-length";

function mint(sub: string): string {
	const encode = (value: object): string =>
		Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
	const encodedHeader = encode({ alg: "HS256", typ: "JWT" });
	const encodedPayload = encode({ sub });
	const signature = createHmac("sha256", SECRET)
		.update(`${encodedHeader}.${encodedPayload}`)
		.digest("base64url");
	return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function executionContextWith(headers: Record<string, string | undefined>) {
	const request = { headers } as {
		headers: Record<string, string | undefined>;
		identityId?: string;
	};
	return {
		getHandler: () => "handler",
		getClass: () => "class",
		switchToHttp: () => ({ getRequest: () => request }),
		getRequest: () => request,
	} as unknown as ExecutionContext;
}

describe("JwtAuthGuard", () => {
	let guard: JwtAuthGuard;
	let reflector: jest.Mocked<Reflector>;
	let configService: jest.Mocked<ConfigService>;

	beforeEach(() => {
		reflector = {
			getAllAndOverride: jest.fn().mockReturnValue(false),
		} as never;
		configService = {
			get: jest
				.fn()
				.mockImplementation((key: string) =>
					key === "AUTH_JWT_SECRET" ? SECRET : undefined,
				),
		} as never;
		guard = new JwtAuthGuard(reflector, configService);
	});

	it("attaches the identity for a valid token", () => {
		const context = executionContextWith({
			authorization: `Bearer ${mint("user-1")}`,
		});
		expect(guard.canActivate(context)).toBe(true);
		expect(
			(context.switchToHttp().getRequest() as { identityId?: string })
				.identityId,
		).toBe("user-1");
	});

	it("rejects a missing token", () => {
		expect(() => guard.canActivate(executionContextWith({}))).toThrow(
			UnauthorizedException,
		);
	});

	it("rejects a forged token", () => {
		const context = executionContextWith({
			authorization: `Bearer ${mint("user-1")}forged`,
		});
		expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
	});

	it("skips public routes", () => {
		(reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
		expect(guard.canActivate(executionContextWith({}))).toBe(true);
	});
});
