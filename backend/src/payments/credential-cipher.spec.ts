import { randomBytes } from "node:crypto";

import { ConfigService } from "@nestjs/config";

import { CredentialCipher } from "./credential-cipher.service";

describe("CredentialCipher", () => {
	const key = randomBytes(32).toString("base64");

	it("round-trips a secret without storing plaintext", () => {
		const cipher = new CredentialCipher(
			new ConfigService({ PAYMENT_CREDENTIALS_ENCRYPTION_KEY: key }),
		);
		const encrypted = cipher.encrypt("sk_test_super_secret");

		expect(encrypted.ciphertext).not.toContain("sk_test");
		expect(encrypted.iv).toBeTruthy();
		expect(encrypted.tag).toBeTruthy();
		expect(cipher.decrypt(encrypted)).toBe("sk_test_super_secret");
	});

	it("rejects tampered ciphertext", () => {
		const cipher = new CredentialCipher(
			new ConfigService({ PAYMENT_CREDENTIALS_ENCRYPTION_KEY: key }),
		);
		const encrypted = cipher.encrypt("sk_test_super_secret");

		expect(() =>
			cipher.decrypt({
				...encrypted,
				ciphertext: Buffer.from("tampered").toString("base64"),
			}),
		).toThrow();
	});

	it("rejects a missing or invalid key configuration", () => {
		expect(() =>
			new CredentialCipher(new ConfigService({})).encrypt("secret"),
		).toThrow("not configured");
		expect(() =>
			new CredentialCipher(
				new ConfigService({
					PAYMENT_CREDENTIALS_ENCRYPTION_KEY:
						Buffer.from("short").toString("base64"),
				}),
			).encrypt("secret"),
		).toThrow("misconfigured");
	});
});
