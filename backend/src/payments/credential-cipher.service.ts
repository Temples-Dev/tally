import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Injectable, InternalServerErrorException } from "@nestjs/common";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { ConfigService } from "@nestjs/config";

export interface EncryptedSecret {
	ciphertext: string;
	iv: string;
	tag: string;
}

@Injectable()
export class CredentialCipher {
	constructor(private readonly config: ConfigService) {}

	encrypt(plaintext: string): EncryptedSecret {
		const key = this.key();
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		const ciphertext = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);
		return {
			ciphertext: ciphertext.toString("base64"),
			iv: iv.toString("base64"),
			tag: cipher.getAuthTag().toString("base64"),
		};
	}

	decrypt(secret: EncryptedSecret): string {
		const key = this.key();
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			Buffer.from(secret.iv, "base64"),
		);
		decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
		return Buffer.concat([
			decipher.update(Buffer.from(secret.ciphertext, "base64")),
			decipher.final(),
		]).toString("utf8");
	}

	private key(): Buffer {
		const configured = this.config.get<string>(
			"PAYMENT_CREDENTIALS_ENCRYPTION_KEY",
		);
		if (typeof configured !== "string" || configured.length === 0) {
			throw new InternalServerErrorException(
				"Payment credential encryption is not configured.",
			);
		}
		const key = Buffer.from(configured, "base64");
		if (key.length !== 32) {
			throw new InternalServerErrorException(
				"Payment credential encryption is misconfigured.",
			);
		}
		return key;
	}
}
