import {
	BadRequestException,
	ForbiddenException,
	NotFoundException,
	UnauthorizedException,
} from "@nestjs/common";

import { ProblemDetailsFilter } from "./problem-details.filter";

function host() {
	const json = jest.fn();
	const status = jest.fn().mockReturnValue({ json });
	const request = { correlationId: "req_test123" };
	return {
		host: {
			switchToHttp: () => ({
				getRequest: () => request,
				getResponse: () => ({ status }),
			}),
		} as never,
		json,
	};
}

describe("ProblemDetailsFilter", () => {
	const filter = new ProblemDetailsFilter();

	it("shapes forbidden errors with the correlation id", () => {
		const { host: hostArg, json } = host();
		filter.catch(new ForbiddenException("No access."), hostArg);

		expect(json).toHaveBeenCalledTimes(1);
		expect(json.mock.calls[0][0]).toMatchObject({
			type: "https://api.tally.dev/errors/forbidden",
			title: "Access denied",
			status: 403,
			code: "FORBIDDEN",
			detail: "No access.",
			requestId: "req_test123",
		});
	});

	it("maps unknown routes and auth failures to stable codes", () => {
		for (const [exception, code, status] of [
			[new NotFoundException(), "NOT_FOUND", 404],
			[new UnauthorizedException(), "UNAUTHENTICATED", 401],
			[
				new BadRequestException(["name must be longer"]),
				"VALIDATION_ERROR",
				400,
			],
		] as const) {
			const { host: hostArg, json } = host();
			filter.catch(exception, hostArg);
			expect(json.mock.calls[0][0]).toMatchObject({ code, status });
		}
	});

	it("hides internals on unexpected failures", () => {
		const { host: hostArg, json } = host();
		filter.catch(new Error("postgres password=secret"), hostArg);

		const body = json.mock.calls[0][0] as Record<string, unknown>;
		expect(body).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
		expect(JSON.stringify(body)).not.toContain("secret");
	});
});
