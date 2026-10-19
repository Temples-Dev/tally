import {
	CancelMode,
	ChangeType,
	EffectiveMode,
	SubscriptionStatus,
} from "./enums";

const TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
	[SubscriptionStatus.PENDING]: [
		SubscriptionStatus.TRIALING,
		SubscriptionStatus.ACTIVE,
		SubscriptionStatus.CANCELLED,
		SubscriptionStatus.EXPIRED,
	],
	[SubscriptionStatus.TRIALING]: [
		SubscriptionStatus.ACTIVE,
		SubscriptionStatus.EXPIRED,
		SubscriptionStatus.CANCELLED,
	],
	[SubscriptionStatus.ACTIVE]: [
		SubscriptionStatus.PAST_DUE,
		SubscriptionStatus.PAUSED,
		SubscriptionStatus.CANCELLED,
		SubscriptionStatus.EXPIRED,
	],
	[SubscriptionStatus.PAST_DUE]: [
		SubscriptionStatus.ACTIVE,
		SubscriptionStatus.PAUSED,
		SubscriptionStatus.CANCELLED,
		SubscriptionStatus.EXPIRED,
	],
	[SubscriptionStatus.PAUSED]: [
		SubscriptionStatus.ACTIVE,
		SubscriptionStatus.CANCELLED,
		SubscriptionStatus.EXPIRED,
	],
	[SubscriptionStatus.CANCELLED]: [],
	[SubscriptionStatus.EXPIRED]: [],
};

const CHANGE_TYPE_FOR: Partial<
	Record<SubscriptionStatus, Partial<Record<SubscriptionStatus, ChangeType>>>
> = {
	[SubscriptionStatus.PENDING]: {
		[SubscriptionStatus.TRIALING]: ChangeType.ACTIVATED,
		[SubscriptionStatus.ACTIVE]: ChangeType.ACTIVATED,
		[SubscriptionStatus.CANCELLED]: ChangeType.CANCELLED,
		[SubscriptionStatus.EXPIRED]: ChangeType.EXPIRED,
	},
	[SubscriptionStatus.TRIALING]: {
		[SubscriptionStatus.ACTIVE]: ChangeType.TRIAL_CONVERTED,
		[SubscriptionStatus.CANCELLED]: ChangeType.CANCELLED,
		[SubscriptionStatus.EXPIRED]: ChangeType.EXPIRED,
	},
	[SubscriptionStatus.ACTIVE]: {
		[SubscriptionStatus.PAST_DUE]: ChangeType.PAST_DUE,
		[SubscriptionStatus.PAUSED]: ChangeType.PAUSED,
		[SubscriptionStatus.CANCELLED]: ChangeType.CANCELLED,
		[SubscriptionStatus.EXPIRED]: ChangeType.EXPIRED,
	},
	[SubscriptionStatus.PAST_DUE]: {
		[SubscriptionStatus.ACTIVE]: ChangeType.RECOVERED,
		[SubscriptionStatus.PAUSED]: ChangeType.PAUSED,
		[SubscriptionStatus.CANCELLED]: ChangeType.CANCELLED,
		[SubscriptionStatus.EXPIRED]: ChangeType.EXPIRED,
	},
	[SubscriptionStatus.PAUSED]: {
		[SubscriptionStatus.ACTIVE]: ChangeType.RESUMED,
		[SubscriptionStatus.CANCELLED]: ChangeType.CANCELLED,
		[SubscriptionStatus.EXPIRED]: ChangeType.EXPIRED,
	},
};

export function canTransition(
	from: SubscriptionStatus,
	to: SubscriptionStatus,
): boolean {
	return TRANSITIONS[from].includes(to);
}

export function changeTypeFor(
	from: SubscriptionStatus,
	to: SubscriptionStatus,
): ChangeType {
	const changeType = CHANGE_TYPE_FOR[from]?.[to];
	if (changeType === undefined) {
		throw new Error(`No change type recorded for ${from} to ${to}.`);
	}
	return changeType;
}

/** States in which subscription-based entitlements may still be granted. */
export function isEntitlementEligible(status: SubscriptionStatus): boolean {
	return (
		status === SubscriptionStatus.TRIALING ||
		status === SubscriptionStatus.ACTIVE ||
		status === SubscriptionStatus.PAST_DUE
	);
}

export function cancelModeFor(mode: CancelMode): { immediate: boolean } {
	return { immediate: mode === CancelMode.IMMEDIATE };
}

export function effectiveModeFor(mode: EffectiveMode): { immediate: boolean } {
	return { immediate: mode === EffectiveMode.IMMEDIATE };
}
