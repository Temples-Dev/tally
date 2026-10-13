import { type ExecutionContext, createParamDecorator } from "@nestjs/common";

import type { AuthenticatedRequest } from "./tenant-context";

function authenticatedRequest(context: ExecutionContext): AuthenticatedRequest {
	return context.switchToHttp().getRequest<AuthenticatedRequest>();
}

export const CurrentIdentityId = createParamDecorator(
	(_data: unknown, context: ExecutionContext): string | undefined => {
		return authenticatedRequest(context).identityId;
	},
);

export const CurrentTenantId = createParamDecorator(
	(_data: unknown, context: ExecutionContext): string | undefined => {
		return authenticatedRequest(context).tenantContext?.tenantId;
	},
);
