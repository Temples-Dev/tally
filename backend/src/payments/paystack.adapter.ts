import { createHmac, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { ConfigService } from "@nestjs/config";

import { currencyPrecision } from "../billing/billing-money";

const PAYSTACK_CURRENCIES = new Set(["NGN", "USD", "GHS", "ZAR", "KES", "XOF"]);

export class PaymentProviderError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "PaymentProviderError";
	}
}

export interface InitializePaymentInput {
	secretKey: string;
	email: string;
	amount: bigint;
	currency: string;
	reference: string;
	callbackUrl?: string;
	metadata: Record<string, unknown>;
}

export interface InitializedPayment {
	reference: string;
	authorizationUrl: string;
}

export type VerifiedPaymentStatus = "succeeded" | "failed" | "pending";

export interface VerifiedPayment {
	reference: string;
	transactionId: string;
	status: VerifiedPaymentStatus;
	amount: bigint;
	currency: string;
	paidAt: Date | null;
	gatewayResponse: string | null;
	channel: string | null;
}

interface PaystackResponse {
	status?: unknown;
	message?: unknown;
	data?: unknown;
}

@Injectable()
export class PaystackAdapter {
	private readonly baseUrl: string;

	constructor(config: ConfigService) {
		this.baseUrl = config
			.get<string>("PAYSTACK_BASE_URL", "https://api.paystack.co")
			.replace(/\/$/, "");
	}

	supportsCurrency(currency: string): boolean {
		return (
			PAYSTACK_CURRENCIES.has(currency.toUpperCase()) &&
			currencyPrecision(currency) !== null
		);
	}

	toProviderAmount(amount: bigint, currency: string): string {
		const precision = this.requirePrecision(currency);
		const base = amount / 10n ** BigInt(8 - precision);
		if (currency.toUpperCase() === "XOF") {
			return (base * 100n).toString();
		}
		return base.toString();
	}

	fromProviderAmount(raw: number | string, currency: string): bigint {
		const precision = this.requirePrecision(currency);
		const value =
			typeof raw === "number" ? BigInt(Math.trunc(raw)).toString() : raw.trim();
		if (!/^\d+$/.test(value)) {
			throw new PaymentProviderError(
				"The provider returned an invalid amount.",
				"INVALID_PROVIDER_AMOUNT",
			);
		}
		const units = BigInt(value);
		if (currency.toUpperCase() === "XOF") {
			return (units / 100n) * 10n ** BigInt(8 - precision);
		}
		return units * 10n ** BigInt(8 - precision);
	}

	async initialize(input: InitializePaymentInput): Promise<InitializedPayment> {
		const body = await this.request(
			"/transaction/initialize",
			input.secretKey,
			{
				method: "POST",
				body: JSON.stringify({
					email: input.email,
					amount: this.toProviderAmount(input.amount, input.currency),
					currency: input.currency.toUpperCase(),
					reference: input.reference,
					...(input.callbackUrl === undefined
						? {}
						: { callback_url: input.callbackUrl }),
					metadata: input.metadata,
				}),
			},
		);
		const data = this.record(body.data);
		const authorizationUrl = data.authorization_url;
		const reference = data.reference;
		if (typeof authorizationUrl !== "string" || typeof reference !== "string") {
			throw new PaymentProviderError(
				"The provider did not return a checkout URL.",
				"INVALID_PROVIDER_RESPONSE",
			);
		}
		return { authorizationUrl, reference };
	}

	async verify(secretKey: string, reference: string): Promise<VerifiedPayment> {
		const body = await this.request(
			`/transaction/verify/${encodeURIComponent(reference)}`,
			secretKey,
			{ method: "GET" },
		);
		const data = this.record(body.data);
		const returnedReference = data.reference;
		const transactionId = data.id;
		const currency = data.currency;
		const amount = data.amount;
		const status = data.status;
		if (
			typeof returnedReference !== "string" ||
			(transactionId !== undefined &&
				typeof transactionId !== "number" &&
				typeof transactionId !== "string") ||
			typeof currency !== "string" ||
			(typeof amount !== "number" && typeof amount !== "string") ||
			typeof status !== "string"
		) {
			throw new PaymentProviderError(
				"The provider returned an incomplete transaction.",
				"INVALID_PROVIDER_RESPONSE",
			);
		}
		return {
			reference: returnedReference,
			transactionId: String(transactionId ?? returnedReference),
			status: this.normalizeStatus(status),
			amount: this.fromProviderAmount(amount, currency),
			currency: currency.toUpperCase(),
			paidAt: this.date(data.paid_at),
			gatewayResponse:
				typeof data.gateway_response === "string"
					? data.gateway_response
					: null,
			channel: typeof data.channel === "string" ? data.channel : null,
		};
	}

	verifyWebhook(
		rawBody: Buffer,
		signature: string,
		secretKey: string,
	): boolean {
		const expected = createHmac("sha512", secretKey)
			.update(rawBody)
			.digest("hex");
		const provided = Buffer.from(signature, "hex");
		const expectedBuffer = Buffer.from(expected, "hex");
		if (provided.length !== expectedBuffer.length || provided.length === 0) {
			return false;
		}
		return timingSafeEqual(provided, expectedBuffer);
	}

	private normalizeStatus(status: string): VerifiedPaymentStatus {
		if (status === "success") {
			return "succeeded";
		}
		if (status === "failed" || status === "reversed") {
			return "failed";
		}
		return "pending";
	}

	private async request(
		path: string,
		secretKey: string,
		init: { method: string; body?: string },
	): Promise<PaystackResponse> {
		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}${path}`, {
				method: init.method,
				headers: {
					Authorization: `Bearer ${secretKey}`,
					"Content-Type": "application/json",
				},
				body: init.body,
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new PaymentProviderError(
				"The payment provider is unavailable.",
				"PROVIDER_UNAVAILABLE",
			);
		}
		let body: PaystackResponse;
		try {
			body = (await response.json()) as PaystackResponse;
		} catch {
			throw new PaymentProviderError(
				"The payment provider returned an invalid response.",
				"INVALID_PROVIDER_RESPONSE",
			);
		}
		if (!response.ok || body.status !== true) {
			throw new PaymentProviderError(
				typeof body.message === "string"
					? body.message
					: "The payment provider rejected the request.",
				`PROVIDER_HTTP_${response.status}`,
			);
		}
		return body;
	}

	private record(value: unknown): Record<string, unknown> {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			throw new PaymentProviderError(
				"The payment provider returned an invalid response.",
				"INVALID_PROVIDER_RESPONSE",
			);
		}
		return value as Record<string, unknown>;
	}

	private date(value: unknown): Date | null {
		if (typeof value !== "string") {
			return null;
		}
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	private requirePrecision(currency: string): number {
		const precision = currencyPrecision(currency);
		if (
			precision === null ||
			!PAYSTACK_CURRENCIES.has(currency.toUpperCase())
		) {
			throw new PaymentProviderError(
				`Currency ${currency} is not supported.`,
				"UNSUPPORTED_CURRENCY",
			);
		}
		return precision;
	}
}
