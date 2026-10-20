import { createHmac } from "node:crypto";

import { ConfigService } from "@nestjs/config";

import { PaystackAdapter } from "./paystack.adapter";

describe("PaystackAdapter", () => {
	const adapter = new PaystackAdapter(
		new ConfigService({ PAYSTACK_BASE_URL: "https://api.paystack.co" }),
	);

	it("converts internal amounts to provider subunits", () => {
		expect(adapter.toProviderAmount(5_204_000_000n, "USD")).toBe("5204");
		expect(adapter.fromProviderAmount(5204, "USD")).toBe(5_204_000_000n);
		expect(adapter.toProviderAmount(100_000_000n, "XOF")).toBe("100");
		expect(adapter.fromProviderAmount("100", "XOF")).toBe(100_000_000n);
	});

	it("only supports currencies enabled for the provider", () => {
		expect(adapter.supportsCurrency("NGN")).toBe(true);
		expect(adapter.supportsCurrency("GHS")).toBe(true);
		expect(adapter.supportsCurrency("EUR")).toBe(false);
		expect(() => adapter.toProviderAmount(1_000_000_000n, "EUR")).toThrow(
			"not supported",
		);
	});

	it("verifies the HMAC SHA512 webhook signature", () => {
		const rawBody = Buffer.from(
			JSON.stringify({ event: "charge.success", data: { id: 1 } }),
		);
		const signature = createHmac("sha512", "sk_test_secret")
			.update(rawBody)
			.digest("hex");

		expect(adapter.verifyWebhook(rawBody, signature, "sk_test_secret")).toBe(
			true,
		);
		expect(
			adapter.verifyWebhook(rawBody, "00".repeat(64), "sk_test_secret"),
		).toBe(false);
		expect(adapter.verifyWebhook(rawBody, signature, "sk_test_other")).toBe(
			false,
		);
	});
});
