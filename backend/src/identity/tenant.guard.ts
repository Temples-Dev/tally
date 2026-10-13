import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { Reflector } from "@nestjs/core";

// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "./audit.service";
import {
	ActorType,
	type MemberRole,
	MemberStatus,
	TenantStatus,
} from "./enums";
import { REQUIRED_ROLES_KEY } from "./roles.decorator";
import type { AuthenticatedRequest } from "./tenant-context";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { TenantMembersService } from "./tenant-members.service";

/**
 * Resolves the tenant selected via `x-tenant-id` against verified membership.
 * The header is a selector only; the membership row is the authorization proof.
 */
@Injectable()
export class TenantGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly memberships: TenantMembersService,
		private readonly audit: AuditService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<
			AuthenticatedRequest & {
				headers: Record<string, string | string[] | undefined>;
			}
		>();
		const header = request.headers["x-tenant-id"];
		const tenantId = Array.isArray(header) ? header[0] : header;
		if (typeof tenantId !== "string" || tenantId.length === 0) {
			throw new ForbiddenException(
				"A tenant must be selected for this operation.",
			);
		}
		const identityId = request.identityId;
		if (typeof identityId !== "string" || identityId.length === 0) {
			throw new ForbiddenException("No authenticated identity established.");
		}

		const check = await this.memberships.findActiveMembership(
			identityId,
			tenantId,
		);
		if (check === null) {
			await this.audit.recordSafely({
				tenantId,
				actorType: ActorType.HUMAN,
				actorId: identityId,
				action: "tenant.access-denied",
				resourceType: "tenant",
				resourceId: tenantId,
			});
			throw new NotFoundException("Tenant not found.");
		}
		if (check.tenant.status !== TenantStatus.ACTIVE) {
			throw new ForbiddenException("This tenant is not active.");
		}
		if (check.member.status !== MemberStatus.ACTIVE) {
			throw new ForbiddenException("Membership is not active.");
		}

		const required = this.reflector.getAllAndOverride<MemberRole[]>(
			REQUIRED_ROLES_KEY,
			[context.getHandler(), context.getClass()],
		);
		if (required !== undefined && !required.includes(check.member.role)) {
			throw new ForbiddenException(
				"This operation requires a privileged member role.",
			);
		}

		request.tenantContext = {
			externalIdentityId: identityId,
			tenantId,
			role: check.member.role,
		};
		return true;
	}
}
