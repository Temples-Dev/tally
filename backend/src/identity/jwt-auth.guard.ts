import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { ConfigService } from "@nestjs/config";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { Reflector } from "@nestjs/core";

import { JwtValidationError, verifyJwt } from "./jwt";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Validates the configured IAM bearer token and establishes the request identity.
 * Identity alone grants nothing: tenant routes additionally require TenantGuard.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly configService: ConfigService,
	) {}

	canActivate(context: ExecutionContext): boolean {
		if (
			this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
				context.getHandler(),
				context.getClass(),
			])
		) {
			return true;
		}
		const request = context.switchToHttp().getRequest<{
			headers: Record<string, string | string[] | undefined>;
			identityId?: string;
		}>();
		const header = request.headers.authorization;
		const token = Array.isArray(header) ? header[0] : header;
		if (typeof token !== "string" || !token.startsWith("Bearer ")) {
			throw new UnauthorizedException("Missing bearer token.");
		}
		try {
			const claims = verifyJwt(
				token.slice("Bearer ".length).trim(),
				this.secret(),
				{
					issuer: this.optional("AUTH_JWT_ISSUER"),
					audience: this.optional("AUTH_JWT_AUDIENCE"),
				},
			);
			request.identityId = claims.sub;
			return true;
		} catch (error) {
			if (error instanceof JwtValidationError) {
				throw new UnauthorizedException("Invalid bearer token.");
			}
			throw error;
		}
	}

	private secret(): string {
		const secret = this.configService.get<string>("AUTH_JWT_SECRET");
		if (typeof secret !== "string" || secret.length === 0) {
			throw new UnauthorizedException("Authentication is not configured.");
		}
		return secret;
	}

	private optional(key: string): string | undefined {
		const value = this.configService.get<string>(key);
		return typeof value === "string" && value.length > 0 ? value : undefined;
	}
}
