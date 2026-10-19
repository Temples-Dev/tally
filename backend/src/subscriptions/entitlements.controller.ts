import {
	Body,
	Controller,
	ForbiddenException,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	UseGuards,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";
import {
	Allow,
	IsDateString,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from "class-validator";

import { CurrentIdentityId, CurrentTenantId } from "../identity/decorators";
import { MemberRole } from "../identity/enums";
import { Roles } from "../identity/roles.decorator";
import { TenantGuard } from "../identity/tenant.guard";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { EntitlementsService } from "./entitlements.service";

export class CreateOverrideDto {
	@IsString()
	@MinLength(1)
	subscriptionId: string;

	@IsString()
	@MinLength(1)
	definitionCode: string;

	@Allow()
	value: unknown;

	@IsString()
	@MinLength(2)
	@MaxLength(500)
	reason: string;

	@IsDateString()
	effectiveFrom: string;

	@IsOptional()
	@IsDateString()
	effectiveUntil?: string;
}

@ApiTags("entitlements")
@ApiBearerAuth()
@Controller()
@UseGuards(TenantGuard)
export class EntitlementsController {
	constructor(private readonly entitlements: EntitlementsService) {}

	private assertTenant(
		pathTenantId: string,
		contextTenantId: string | undefined,
	): string {
		if (contextTenantId === undefined || contextTenantId !== pathTenantId) {
			throw new ForbiddenException("Tenant mismatch.");
		}
		return contextTenantId;
	}

	@Get("tenants/:tenantId/entitlements")
	@ApiOperation({ summary: "List effective entitlements" })
	@ApiOkResponse({ description: "Effective values with sources" })
	listEffective(
		@Param("tenantId", ParseUUIDPipe) tenantId: string,
		@CurrentTenantId() contextTenantId?: string,
	) {
		return this.entitlements.listDefinitions(
			this.assertTenant(tenantId, contextTenantId),
		);
	}

	@Get("tenants/:tenantId/entitlements/:key")
	@ApiOperation({ summary: "Evaluate one entitlement" })
	@ApiOkResponse({ description: "Decision with value and reason" })
	evaluateOne(
		@Param("tenantId", ParseUUIDPipe) tenantId: string,
		@Param("key") key: string,
		@Query("at") at: string | undefined,
		@CurrentTenantId() contextTenantId?: string,
	) {
		return this.entitlements.evaluate(
			this.assertTenant(tenantId, contextTenantId),
			key,
			at === undefined ? new Date() : new Date(at),
		);
	}

	@Post("entitlement-overrides")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a tenant entitlement override" })
	@ApiCreatedResponse({ description: "Override created" })
	createOverride(
		@Body() dto: CreateOverrideDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		if (tenantId === undefined || identityId === undefined) {
			throw new ForbiddenException("Tenant and identity context are required.");
		}
		return this.entitlements.createOverride(tenantId, identityId, {
			...dto,
			effectiveFrom: new Date(dto.effectiveFrom),
			effectiveUntil:
				dto.effectiveUntil === undefined ? null : new Date(dto.effectiveUntil),
		});
	}
}
