export enum TenantStatus {
	ACTIVE = "active",
	SUSPENDED = "suspended",
	CLOSED = "closed",
}

export enum MemberRole {
	OWNER = "owner",
	ADMINISTRATOR = "administrator",
	BILLING_MANAGER = "billing_manager",
	DEVELOPER = "developer",
	VIEWER = "viewer",
}

export enum MemberStatus {
	ACTIVE = "active",
	SUSPENDED = "suspended",
	REMOVED = "removed",
}

export enum ActorType {
	HUMAN = "human",
	SERVICE = "service",
	SYSTEM = "system",
}
