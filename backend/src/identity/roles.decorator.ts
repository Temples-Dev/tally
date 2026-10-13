import { SetMetadata } from "@nestjs/common";

import type { MemberRole } from "./enums";

export const REQUIRED_ROLES_KEY = "tally:required-roles";

/** Restricts a tenant-scoped route to the given member roles. */
export const Roles = (...roles: MemberRole[]) =>
	SetMetadata(REQUIRED_ROLES_KEY, roles);
