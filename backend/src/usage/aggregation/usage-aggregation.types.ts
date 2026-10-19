import { createHash } from "node:crypto";

import { canonicalJson } from "../usage-payload";

export const USAGE_AGGREGATION_JOB = "usage.aggregate";

export interface UsageAggregationJobPayload {
	tenantId: string;
	customerAccountId: string;
	subscriptionId: string | null;
	metricId: string;
	periodStart: string;
	periodEnd: string;
	dimensions: Record<string, unknown>;
}

export interface AggregationScope {
	tenantId: string;
	customerAccountId: string;
	subscriptionId: string | null;
	metricId: string;
	periodStart: Date;
	periodEnd: Date;
	dimensions: Record<string, unknown>;
}

/** Resolves the half-open UTC calendar-day window for an event timestamp. */
export function utcDayBounds(occurredAt: Date): {
	start: Date;
	end: Date;
} {
	const start = new Date(
		Date.UTC(
			occurredAt.getUTCFullYear(),
			occurredAt.getUTCMonth(),
			occurredAt.getUTCDate(),
		),
	);
	return { start, end: new Date(start.getTime() + 86_400_000) };
}

/**
 * Stable identity for an aggregate scope. Dimensions are canonicalized so
 * equivalent maps hash identically regardless of key order.
 */
export function aggregateScopeKey(scope: {
	customerAccountId: string;
	subscriptionId: string | null;
	metricId: string;
	dimensions: Record<string, unknown>;
}): string {
	return createHash("sha256")
		.update(
			canonicalJson({
				customerAccountId: scope.customerAccountId,
				subscriptionId: scope.subscriptionId,
				metricId: scope.metricId,
				dimensions: scope.dimensions,
			}),
		)
		.digest("hex");
}
