import { UnprocessableEntityException } from "@nestjs/common";

import { QuotaWindowType } from "./enums";
import { resolveQuotaPeriod } from "./quota-period";

const subscription = {
	startedAt: new Date("2026-01-15T10:00:00.000Z"),
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	currentPeriodStart: new Date("2026-10-01T00:00:00.000Z"),
	currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
};

describe("quota periods", () => {
	it("anchors fixed UTC windows to the epoch", () => {
		const period = resolveQuotaPeriod(
			QuotaWindowType.DAY,
			1,
			subscription,
			new Date("2026-10-19T13:45:00.000Z"),
		);
		expect(period.start.toISOString()).toBe("2026-10-19T00:00:00.000Z");
		expect(period.end.toISOString()).toBe("2026-10-20T00:00:00.000Z");
	});

	it("supports multi-unit fixed windows", () => {
		const period = resolveQuotaPeriod(
			QuotaWindowType.HOUR,
			6,
			subscription,
			new Date("2026-10-19T13:45:00.000Z"),
		);
		expect(period.start.toISOString()).toBe("2026-10-19T12:00:00.000Z");
		expect(period.end.toISOString()).toBe("2026-10-19T18:00:00.000Z");
	});

	it("uses UTC calendar months", () => {
		const single = resolveQuotaPeriod(
			QuotaWindowType.MONTH,
			1,
			subscription,
			new Date("2026-10-19T13:45:00.000Z"),
		);
		expect(single.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(single.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");

		const quarter = resolveQuotaPeriod(
			QuotaWindowType.MONTH,
			3,
			subscription,
			new Date("2026-10-19T13:45:00.000Z"),
		);
		expect(quarter.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(quarter.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
	});

	it("uses authoritative billing-period boundaries", () => {
		const period = resolveQuotaPeriod(
			QuotaWindowType.BILLING_PERIOD,
			null,
			subscription,
			new Date("2026-10-19T13:45:00.000Z"),
		);
		expect(period.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(period.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
	});

	it("rejects billing-period quotas without a current period", () => {
		expect(() =>
			resolveQuotaPeriod(
				QuotaWindowType.BILLING_PERIOD,
				null,
				{ ...subscription, currentPeriodStart: null, currentPeriodEnd: null },
				new Date(),
			),
		).toThrow(UnprocessableEntityException);
	});

	it("uses the subscription lifetime for lifetime quotas", () => {
		const period = resolveQuotaPeriod(
			QuotaWindowType.LIFETIME,
			null,
			subscription,
			new Date("2026-10-19T13:45:00.000Z"),
		);
		expect(period.start.toISOString()).toBe("2026-01-15T10:00:00.000Z");
		expect(period.end.getUTCFullYear()).toBe(9999);
	});
});
