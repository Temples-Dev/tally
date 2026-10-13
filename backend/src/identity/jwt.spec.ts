import { createHmac } from "node:crypto";

import { JwtValidationError, verifyJwt } from "./jwt";

const SECRET = "test-secret-with-enough-length";

function mint(payload: Record<string, unknown>): string {
	const encode = (value: object): string =>
		Buffer.from(JSON.stringify(value), "utf8")
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "");
	const encodedHeader = encode({ alg: "HS256", typ: "JWT" });
	const encodedPayload = encode(payload);
	const signature = createHmac("sha256", SECRET)
		.update(`${encodedHeader}.${encodedPayload}`)
		.digest("base64url");
	return `${encodedHeader}.${encodedPayload}.${signature}`;
}

describe("verifyJwt", () => {
	it("accepts a valid token and returns claims", () => {
		const claims = verifyJwt(mint({ sub: "user-1" }), SECRET);
		expect(claims.sub).toBe("user-1");
	});

	it("rejects a tampered signature", () => {
		const token = mint({ sub: "user-1" });
		const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
		expect(() => verifyJwt(tampered, SECRET)).toThrow(JwtValidationError);
	});

	it("rejects an expired token", () => {
		const token = mint({
			sub: "user-1",
			exp: Math.floor(Date.now() / 1000) - 60,
		});
		expect(() => verifyJwt(token, SECRET)).toThrow("Token expired.");
	});

	it("rejects a missing subject", () => {
		expect(() => verifyJwt(mint({}), SECRET)).toThrow("Malformed token.");
	});

	it("enforces issuer and audience when configured", () => {
		const token = mint({ sub: "user-1", iss: "other", aud: "other" });
		expect(() => verifyJwt(token, SECRET, { issuer: "tally" })).toThrow(
			"Unexpected issuer.",
		);
		expect(() => verifyJwt(token, SECRET, { audience: "tally-api" })).toThrow(
			"Unexpected audience.",
		);
		expect(() =>
			verifyJwt(
				mint({ sub: "user-1", iss: "tally", aud: "tally-api" }),
				SECRET,
				{
					issuer: "tally",
					audience: "tally-api",
				},
			),
		).not.toThrow();
	});
});
