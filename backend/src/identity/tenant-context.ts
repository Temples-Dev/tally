import type { MemberRole } from "./enums";

export interface IdentityContext {
	externalIdentityId: string;
}

export interface TenantContext extends IdentityContext {
	tenantId: string;
	role: MemberRole;
}

/** Request-attached auth state. Guards write it; decorators read it. */
export interface AuthenticatedRequest {
	identityId?: string;
	tenantContext?: TenantContext;
}
