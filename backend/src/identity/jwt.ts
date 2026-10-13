import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtClaims {
	sub: string;
	iss?: string;
	aud?: string | string[];
	exp?: number;
	iat?: number;
	[key: string]: unknown;
}

export class JwtValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JwtValidationError";
	}
}

function base64UrlEncode(value: string | Buffer): string {
	const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
	return buffer
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Buffer {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(padded, "base64");
}

/** Minimal HS256 JWT verification. The IAM provider signs short-lived tokens; no password store here. */
export function verifyJwt(
	token: string,
	secret: string,
	options: { issuer?: string; audience?: string } = {},
): JwtClaims {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new JwtValidationError("Malformed token.");
	}
	const [encodedHeader, encodedPayload, encodedSignature] = parts;

	let header: unknown;
	let claims: unknown;
	try {
		header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8"));
		claims = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
	} catch {
		throw new JwtValidationError("Malformed token.");
	}
	if (
		typeof header !== "object" ||
		header === null ||
		(header as { alg?: unknown }).alg !== "HS256" ||
		typeof claims !== "object" ||
		claims === null ||
		typeof (claims as { sub?: unknown }).sub !== "string"
	) {
		throw new JwtValidationError("Malformed token.");
	}

	const expected = createHmac("sha256", secret)
		.update(`${encodedHeader}.${encodedPayload}`)
		.digest();
	const actual = base64UrlDecode(encodedSignature);
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
		throw new JwtValidationError("Invalid signature.");
	}

	const typed = claims as JwtClaims;
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (typed.exp !== undefined && typed.exp <= nowSeconds) {
		throw new JwtValidationError("Token expired.");
	}
	if (options.issuer !== undefined && typed.iss !== options.issuer) {
		throw new JwtValidationError("Unexpected issuer.");
	}
	if (options.audience !== undefined) {
		const audiences = Array.isArray(typed.aud) ? typed.aud : [typed.aud];
		if (!audiences.includes(options.audience)) {
			throw new JwtValidationError("Unexpected audience.");
		}
	}
	return typed;
}
