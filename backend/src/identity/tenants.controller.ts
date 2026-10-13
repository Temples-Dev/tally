import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	NotFoundException,
	Param,
	ParseUUIDPipe,
	Post,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiCreatedResponse,
	ApiForbiddenResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

import { CurrentIdentityId } from "./decorators";
import type { Tenant } from "./entities/tenant.entity";
import { TenantGuard } from "./tenant.guard";
// biome-ignore lint/style/useImportType: service token must be a value import for decorator metadata.
import { TenantsService } from "./tenants.service";

export class CreateTenantDto {
	@IsString()
	@MinLength(2)
	@MaxLength(200)
	name: string;

	@IsOptional()
	@IsString()
	@MaxLength(200)
	slug?: string;
}

function tenantBody(tenant: Tenant) {
	return {
		id: tenant.id,
		name: tenant.name,
		slug: tenant.slug,
		status: tenant.status,
		createdAt: tenant.createdAt.toISOString(),
		updatedAt: tenant.updatedAt.toISOString(),
	};
}

@ApiTags("tenants")
@ApiBearerAuth()
@Controller("tenants")
export class TenantsController {
	constructor(private readonly tenants: TenantsService) {}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a tenant; the caller becomes its owner" })
	@ApiCreatedResponse({ description: "Tenant created" })
	@ApiUnauthorizedResponse({ description: "Missing or invalid authentication" })
	@ApiForbiddenResponse({ description: "Tenant selection required" })
	async create(
		@Body() dto: CreateTenantDto,
		@CurrentIdentityId() identityId?: string,
	): Promise<Record<string, unknown>> {
		if (identityId === undefined) {
			throw new UnauthorizedException("Missing authenticated identity.");
		}
		const tenant = await this.tenants.createTenant({
			name: dto.name,
			slug: dto.slug,
			externalIdentityId: identityId,
		});
		return tenantBody(tenant);
	}

	@Get(":id")
	@UseGuards(TenantGuard)
	@ApiOperation({ summary: "Get a tenant the caller belongs to" })
	@ApiOkResponse({ description: "Tenant details" })
	@ApiNotFoundResponse({ description: "Tenant not found" })
	async getById(
		@Param("id", ParseUUIDPipe) id: string,
	): Promise<Record<string, unknown>> {
		const tenant = await this.tenants.getTenant(id);
		if (tenant === null) {
			throw new NotFoundException("Tenant not found.");
		}
		return tenantBody(tenant);
	}
}
