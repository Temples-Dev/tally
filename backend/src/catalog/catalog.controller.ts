import {
	Body,
	Controller,
	ForbiddenException,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseUUIDPipe,
	Patch,
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
	IsArray,
	IsBoolean,
	IsDateString,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	Min,
	MinLength,
} from "class-validator";
import { AggregationMethod, EntitlementValueType } from "./enums";

import { CurrentTenantId } from "../identity/decorators";
import { MemberRole } from "../identity/enums";
import { Roles } from "../identity/roles.decorator";
import { TenantGuard } from "../identity/tenant.guard";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { CatalogService } from "./catalog.service";

export class CreateProductDto {
	@IsString()
	@MinLength(2)
	@MaxLength(100)
	code: string;

	@IsString()
	@MinLength(2)
	@MaxLength(200)
	name: string;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	description?: string;
}

export class CreatePlanDto {
	@IsUUID()
	productId: string;

	@IsString()
	@MinLength(2)
	@MaxLength(100)
	code: string;

	@IsString()
	@MinLength(2)
	@MaxLength(200)
	name: string;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	description?: string;
}

export class PublishVersionDto {
	@IsOptional()
	@IsDateString()
	effectiveFrom?: string;
}

export class SetPlanEntitlementDto {
	@IsString()
	@MinLength(1)
	definitionCode: string;

	@Allow()
	value: unknown;
}

export class CreateMeterDto {
	@IsString()
	@MinLength(2)
	@MaxLength(100)
	code: string;

	@IsString()
	@MinLength(2)
	@MaxLength(200)
	name: string;

	@IsString()
	@MinLength(1)
	@MaxLength(32)
	unit: string;

	@IsOptional()
	@IsEnum(AggregationMethod)
	aggregationMethod?: AggregationMethod;

	@IsOptional()
	@IsBoolean()
	allowsNegative?: boolean;

	@IsOptional()
	@IsInt()
	@Min(0)
	maxEventAgeSeconds?: number | null;

	@IsOptional()
	@IsInt()
	@Min(0)
	maxFutureSkewSeconds?: number;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	allowedDimensions?: string[] | null;
}

export class CreateDefinitionDto {
	@IsString()
	@MinLength(2)
	@MaxLength(100)
	code: string;

	@IsString()
	@MinLength(2)
	@MaxLength(200)
	name: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsEnum(EntitlementValueType)
	valueType: EntitlementValueType;

	@IsOptional()
	defaultValue?: unknown;

	@IsOptional()
	validationSchema?: Record<string, unknown>;
}

function requireTenant(tenantId: string | undefined): string {
	if (tenantId === undefined) {
		throw new ForbiddenException("Tenant context is required.");
	}
	return tenantId;
}

@ApiTags("catalog")
@ApiBearerAuth()
@Controller()
@UseGuards(TenantGuard)
export class CatalogController {
	constructor(
		private readonly catalog: CatalogService,
		private readonly subscriptions: SubscriptionsService,
	) {}

	@Post("products")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a product" })
	@ApiCreatedResponse({ description: "Product created" })
	createProduct(
		@Body() dto: CreateProductDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.catalog.createProduct(requireTenant(tenantId), dto);
	}

	@Get("products")
	@ApiOperation({ summary: "List products" })
	@ApiOkResponse({ description: "Product list" })
	listProducts(@CurrentTenantId() tenantId?: string) {
		return this.catalog.listProducts(requireTenant(tenantId));
	}

	@Post("plans")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a plan" })
	@ApiCreatedResponse({ description: "Plan created" })
	createPlan(@Body() dto: CreatePlanDto, @CurrentTenantId() tenantId?: string) {
		return this.catalog.createPlan(requireTenant(tenantId), dto);
	}

	@Get("plans")
	@ApiOperation({ summary: "List plans" })
	@ApiOkResponse({ description: "Plan list" })
	listPlans(
		@Query("productId") productId: string | undefined,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.catalog.listPlans(requireTenant(tenantId), productId);
	}

	@Get("plans/:id")
	@ApiOperation({ summary: "Retrieve a plan with its versions" })
	@ApiOkResponse({ description: "Plan details" })
	async getPlan(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentTenantId() tenantId?: string,
	) {
		const resolved = requireTenant(tenantId);
		const plan = await this.catalog.requirePlan(resolved, id);
		const versions = await this.catalog.listVersions(resolved, id);
		return { ...plan, versions };
	}

	@Post("plans/:id/versions")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a draft plan version" })
	@ApiCreatedResponse({ description: "Draft version created" })
	createVersion(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: PublishVersionDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.catalog.createPlanVersion(requireTenant(tenantId), id, {
			effectiveFrom:
				dto.effectiveFrom === undefined
					? undefined
					: new Date(dto.effectiveFrom),
		});
	}

	@Get("plans/:id/versions")
	@ApiOperation({ summary: "List plan versions" })
	@ApiOkResponse({ description: "Version list" })
	listVersions(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.catalog.listVersions(requireTenant(tenantId), id);
	}

	@Post("plans/:id/versions/:versionId/publish")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Publish a draft plan version" })
	@ApiOkResponse({ description: "Version published" })
	publishVersion(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("versionId", ParseUUIDPipe) versionId: string,
		@Body() dto: PublishVersionDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.catalog.publishVersion(
			requireTenant(tenantId),
			id,
			versionId,
			dto.effectiveFrom === undefined ? undefined : new Date(dto.effectiveFrom),
		);
	}

	@Post("plans/:id/versions/:versionId/entitlements")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Set an entitlement value on a draft version" })
	@ApiOkResponse({ description: "Entitlement value set" })
	setEntitlement(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("versionId", ParseUUIDPipe) versionId: string,
		@Body() dto: SetPlanEntitlementDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.catalog.setPlanEntitlement(
			requireTenant(tenantId),
			id,
			versionId,
			dto.definitionCode,
			dto.value,
		);
	}

	@Post("meters")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a usage meter" })
	@ApiCreatedResponse({ description: "Meter created" })
	createMeter(
		@Body() dto: CreateMeterDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.catalog.createMeter(requireTenant(tenantId), dto);
	}

	@Get("meters")
	@ApiOperation({ summary: "List usage meters" })
	@ApiOkResponse({ description: "Meter list" })
	listMeters(@CurrentTenantId() tenantId?: string) {
		return this.catalog.listMeters(requireTenant(tenantId));
	}

	@Post("entitlement-definitions")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create an entitlement definition" })
	@ApiCreatedResponse({ description: "Definition created" })
	createDefinition(
		@Body() dto: CreateDefinitionDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.catalog.createDefinition(requireTenant(tenantId), dto);
	}

	@Get("entitlement-definitions")
	@ApiOperation({ summary: "List entitlement definitions" })
	@ApiOkResponse({ description: "Definition list" })
	listDefinitions(@CurrentTenantId() tenantId?: string) {
		return this.catalog.listDefinitions(requireTenant(tenantId));
	}

	@Patch("plans/:id/archive")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@ApiOperation({ summary: "Archive a plan with no live subscriptions" })
	@ApiOkResponse({ description: "Plan archived" })
	async archivePlan(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentTenantId() tenantId?: string,
	) {
		const resolved = requireTenant(tenantId);
		const versions = await this.catalog.listVersions(resolved, id);
		await this.subscriptions.assertNoLiveSubscriptions(
			resolved,
			versions.map((version) => version.id),
		);
		return this.catalog.archivePlan(resolved, id);
	}
}
