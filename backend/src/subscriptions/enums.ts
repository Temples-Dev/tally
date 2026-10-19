export enum CustomerStatus {
	ACTIVE = "active",
	SUSPENDED = "suspended",
	CLOSED = "closed",
}

export enum SubscriptionStatus {
	PENDING = "pending",
	TRIALING = "trialing",
	ACTIVE = "active",
	PAST_DUE = "past_due",
	PAUSED = "paused",
	CANCELLED = "cancelled",
	EXPIRED = "expired",
}

export enum CancelMode {
	PERIOD_END = "period_end",
	IMMEDIATE = "immediate",
}

export enum EffectiveMode {
	IMMEDIATE = "immediate",
	PERIOD_END = "period_end",
}

export enum ChangeType {
	CREATED = "created",
	ACTIVATED = "activated",
	TRIAL_CONVERTED = "trial_converted",
	PAUSED = "paused",
	RESUMED = "resumed",
	PAST_DUE = "past_due",
	RECOVERED = "recovered",
	PLAN_CHANGE_REQUESTED = "plan_change_requested",
	PLAN_CHANGE_APPLIED = "plan_change_applied",
	CANCEL_REQUESTED = "cancel_requested",
	CANCELLED = "cancelled",
	EXPIRED = "expired",
}

export enum ChangeStatus {
	PENDING = "pending",
	APPLIED = "applied",
	SUPERSEDED = "superseded",
}
