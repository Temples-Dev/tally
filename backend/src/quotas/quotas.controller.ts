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
	UseGuards,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";

import { CurrentIdentityId, CurrentTenantId } from "../identity/decorators";
import { MemberRole } from "../identity/enums";
import { Roles } from "../identity/roles.decorator";
import { TenantGuard } from "../identity/tenant.guard";
// biome-ignore lint/style/useImportType: DTO classes must be value imports for decorator metadata.
import {
	CommitReservationDto,
	CreateQuotaPolicyDto,
	CreateReservationDto,
	UpdateQuotaPolicyDto,
} from "./quota.dto";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { QuotasService } from "./quotas.service";

function requireTenant(tenantId: string | undefined): string {
	if (tenantId === undefined) {
		throw new ForbiddenException("Tenant context is required.");
	}
	return tenantId;
}

@ApiTags("quotas")
@ApiBearerAuth()
@Controller()
@UseGuards(TenantGuard)
export class QuotasController {
	constructor(private readonly quotas: QuotasService) {}

	private assertTenant(
		pathTenantId: string,
		contextTenantId: string | undefined,
	): string {
		if (contextTenantId === undefined || contextTenantId !== pathTenantId) {
			throw new ForbiddenException("Tenant mismatch.");
		}
		return contextTenantId;
	}

	@Get("tenants/:tenantId/quotas")
	@ApiOperation({ summary: "List effective quotas and current accounting" })
	@ApiOkResponse({ description: "Effective quota policies" })
	list(
		@Param("tenantId", ParseUUIDPipe) tenantId: string,
		@CurrentTenantId() contextTenantId?: string,
	) {
		return this.quotas.list(this.assertTenant(tenantId, contextTenantId));
	}

	@Get("tenants/:tenantId/quotas/reconciliation")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@ApiOperation({ summary: "Reconcile reservation records against counters" })
	@ApiOkResponse({ description: "Quota reconciliation result" })
	reconciliation(
		@Param("tenantId", ParseUUIDPipe) tenantId: string,
		@CurrentTenantId() contextTenantId?: string,
	) {
		return this.quotas.reconciliation(
			this.assertTenant(tenantId, contextTenantId),
		);
	}

	@Get("tenants/:tenantId/quotas/:key")
	@ApiOperation({ summary: "Retrieve one effective quota" })
	@ApiOkResponse({ description: "Quota policy and accounting" })
	get(
		@Param("tenantId", ParseUUIDPipe) tenantId: string,
		@Param("key") key: string,
		@CurrentTenantId() contextTenantId?: string,
	) {
		return this.quotas.get(this.assertTenant(tenantId, contextTenantId), key);
	}

	@Post("tenants/:tenantId/quotas")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a quota policy" })
	@ApiCreatedResponse({ description: "Quota policy created" })
	create(
		@Param("tenantId", ParseUUIDPipe) tenantId: string,
		@Body() dto: CreateQuotaPolicyDto,
		@CurrentTenantId() contextTenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		if (identityId === undefined) {
			throw new ForbiddenException("Identity context is required.");
		}
		return this.quotas.create(
			this.assertTenant(tenantId, contextTenantId),
			identityId,
			dto,
		);
	}

	@Patch("tenants/:tenantId/quotas/:key")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@ApiOperation({ summary: "Update a quota policy" })
	@ApiOkResponse({ description: "Quota policy updated" })
	update(
		@Param("tenantId", ParseUUIDPipe) tenantId: string,
		@Param("key") key: string,
		@Body() dto: UpdateQuotaPolicyDto,
		@CurrentTenantId() contextTenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		if (identityId === undefined) {
			throw new ForbiddenException("Identity context is required.");
		}
		return this.quotas.update(
			this.assertTenant(tenantId, contextTenantId),
			identityId,
			key,
			dto,
		);
	}

	@Post("quota-reservations")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR, MemberRole.DEVELOPER)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Reserve quota capacity idempotently" })
	@ApiCreatedResponse({ description: "Quota reservation created" })
	createReservation(
		@Body() dto: CreateReservationDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.quotas.createReservation(requireTenant(tenantId), dto);
	}

	@Get("quota-reservations/:reservationId")
	@ApiOperation({ summary: "Retrieve a quota reservation" })
	@ApiOkResponse({ description: "Quota reservation" })
	getReservation(
		@Param("reservationId", ParseUUIDPipe) reservationId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.quotas.getReservation(requireTenant(tenantId), reservationId);
	}

	@Post("quota-reservations/:reservationId/commit")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR, MemberRole.DEVELOPER)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Commit a quota reservation" })
	@ApiOkResponse({ description: "Committed quota reservation" })
	commit(
		@Param("reservationId", ParseUUIDPipe) reservationId: string,
		@Body() dto: CommitReservationDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.quotas.commitReservation(
			requireTenant(tenantId),
			reservationId,
			dto,
		);
	}

	@Post("quota-reservations/:reservationId/release")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR, MemberRole.DEVELOPER)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Release a quota reservation" })
	@ApiOkResponse({ description: "Released quota reservation" })
	release(
		@Param("reservationId", ParseUUIDPipe) reservationId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.quotas.releaseReservation(
			requireTenant(tenantId),
			reservationId,
		);
	}
}
