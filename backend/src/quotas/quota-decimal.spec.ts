import {
	addQuotaAmounts,
	formatQuotaAmount,
	parseQuotaAmount,
} from "./quota-decimal";

describe("quota decimal arithmetic", () => {
	it("parses and formats exact fixed-point values", () => {
		expect(parseQuotaAmount("0.00000001")).toBe(1n);
		expect(parseQuotaAmount("5")).toBe(500_000_000n);
		expect(parseQuotaAmount("1.5")).toBe(150_000_000n);
		expect(formatQuotaAmount(1n)).toBe("0.00000001");
		expect(formatQuotaAmount(150_000_000n)).toBe("1.5");
		expect(formatQuotaAmount(500_000_000n)).toBe("5");
	});

	it("adds without binary floating point drift", () => {
		expect(addQuotaAmounts("0.1", "0.2")).toBe("0.3");
		expect(addQuotaAmounts("9999999999999999", "0.00000001")).toBe(
			"9999999999999999.00000001",
		);
	});

	it("rejects negative and malformed values", () => {
		expect(parseQuotaAmount("-1")).toBeNull();
		expect(parseQuotaAmount("1e3")).toBeNull();
		expect(parseQuotaAmount("1.123456789")).toBeNull();
		expect(parseQuotaAmount("")).toBeNull();
	});
});
