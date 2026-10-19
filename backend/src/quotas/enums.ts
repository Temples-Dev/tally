export enum QuotaWindowType {
	MINUTE = "minute",
	HOUR = "hour",
	DAY = "day",
	MONTH = "month",
	BILLING_PERIOD = "billing_period",
	LIFETIME = "lifetime",
	CONCURRENT = "concurrent",
}

export enum QuotaEnforcementMode {
	HARD = "hard",
	SOFT = "soft",
	RATE = "rate",
	CONCURRENT = "concurrent",
	OBSERVE_ONLY = "observe_only",
}

export enum QuotaOveragePolicy {
	DENY = "deny",
	ALLOW = "allow",
	CHARGE = "charge",
}

export enum QuotaReservationStatus {
	RESERVED = "reserved",
	COMMITTED = "committed",
	RELEASED = "released",
	EXPIRED = "expired",
}

/** Enforcement modes that reject an operation which would exceed the limit. */
export function isBlockingMode(mode: QuotaEnforcementMode): boolean {
	return (
		mode === QuotaEnforcementMode.HARD ||
		mode === QuotaEnforcementMode.RATE ||
		mode === QuotaEnforcementMode.CONCURRENT
	);
}
