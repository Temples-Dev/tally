import { UnprocessableEntityException } from "@nestjs/common";

import type { Subscription } from "../subscriptions/entities/subscription.entity";
import { QuotaWindowType } from "./enums";

export interface QuotaPeriod {
	start: Date;
	end: Date;
}

const MAX_DATE = new Date("9999-12-31T00:00:00.000Z");

/**
 * Resolves the UTC period that a quota policy applies to. Periods are
 * deterministic: fixed windows are anchored to the UTC epoch and calendar
 * months are anchored to the first day of the month in UTC.
 */
export function resolveQuotaPeriod(
	windowType: QuotaWindowType,
	windowSize: number | null,
	subscription: Pick<
		Subscription,
		"startedAt" | "createdAt" | "currentPeriodStart" | "currentPeriodEnd"
	>,
	now: Date,
): QuotaPeriod {
	const size = windowSize ?? 1;
	if (!Number.isInteger(size) || size < 1 || size > 100_000) {
		throw new UnprocessableEntityException(
			"windowSize must be a positive integer.",
		);
	}

	switch (windowType) {
		case QuotaWindowType.MINUTE:
			return fixedWindow(now, 60_000, size);
		case QuotaWindowType.HOUR:
			return fixedWindow(now, 3_600_000, size);
		case QuotaWindowType.DAY:
			return fixedWindow(now, 86_400_000, size);
		case QuotaWindowType.MONTH:
			return monthWindow(now, size);
		case QuotaWindowType.BILLING_PERIOD:
			if (
				subscription.currentPeriodStart === null ||
				subscription.currentPeriodEnd === null
			) {
				throw new UnprocessableEntityException(
					"The subscription does not have an active billing period.",
				);
			}
			return {
				start: subscription.currentPeriodStart,
				end: subscription.currentPeriodEnd,
			};
		case QuotaWindowType.LIFETIME:
			return {
				start: subscription.startedAt ?? subscription.createdAt,
				end: MAX_DATE,
			};
		case QuotaWindowType.CONCURRENT:
			return {
				start: subscription.startedAt ?? subscription.createdAt,
				end: MAX_DATE,
			};
	}
}

function fixedWindow(now: Date, unitMs: number, size: number): QuotaPeriod {
	const unit = Math.floor(now.getTime() / unitMs);
	const bucket = Math.floor(unit / size) * size;
	const start = bucket * unitMs;
	return {
		start: new Date(start),
		end: new Date(start + size * unitMs),
	};
}

function monthWindow(now: Date, size: number): QuotaPeriod {
	const monthIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
	const startIndex = Math.floor(monthIndex / size) * size;
	const startYear = Math.floor(startIndex / 12);
	const startMonth = startIndex % 12;
	return {
		start: new Date(Date.UTC(startYear, startMonth, 1)),
		end: new Date(Date.UTC(startYear, startMonth + size, 1)),
	};
}
