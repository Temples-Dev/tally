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

import { CurrentIdentityId, CurrentTenantId } from "../identity/decorators";
import { MemberRole } from "../identity/enums";
import { Roles } from "../identity/roles.decorator";
import { TenantGuard } from "../identity/tenant.guard";
// biome-ignore lint/style/useImportType: DTO classes must be value imports for decorator metadata.
import {
	ListDiscrepanciesQueryDto,
	ResolveDiscrepancyDto,
} from "./billing-reconciliation.dto";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BillingReconciliationService } from "./billing-reconciliation.service";

function requireTenant(tenantId: string | undefined): string {
	if (tenantId === undefined) {
		throw new ForbiddenException("Tenant context is required.");
	}
	return tenantId;
}

@ApiTags("billing")
@ApiBearerAuth()
@Controller()
@UseGuards(TenantGuard)
export class BillingReconciliationController {
	constructor(private readonly reconciliation: BillingReconciliationService) {}

	@Post("billing/reconciliation-runs")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: "Start a billing reconciliation run" })
	@ApiCreatedResponse({ description: "Reconciliation run queued" })
	startRun(
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		return this.reconciliation.start(
			requireTenant(tenantId),
			this.requireIdentity(identityId),
		);
	}

	@Get("billing/reconciliation-runs")
	@ApiOperation({ summary: "List reconciliation runs" })
	@ApiOkResponse({ description: "Reconciliation runs" })
	listRuns(@CurrentTenantId() tenantId?: string) {
		return this.reconciliation.listRuns(requireTenant(tenantId));
	}

	@Get("billing/reconciliation-runs/:runId")
	@ApiOperation({ summary: "Retrieve a reconciliation run" })
	@ApiOkResponse({ description: "Reconciliation run" })
	getRun(
		@Param("runId", ParseUUIDPipe) runId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.reconciliation.getRun(requireTenant(tenantId), runId);
	}

	@Get("billing/discrepancies")
	@ApiOperation({ summary: "List billing discrepancies" })
	@ApiOkResponse({ description: "Billing discrepancies" })
	listDiscrepancies(
		@Query() query: ListDiscrepanciesQueryDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.reconciliation.listDiscrepancies(
			requireTenant(tenantId),
			query,
		);
	}

	@Post("billing/discrepancies/:discrepancyId/resolve")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Resolve or ignore a billing discrepancy" })
	@ApiOkResponse({ description: "Discrepancy resolved" })
	resolveDiscrepancy(
		@Param("discrepancyId", ParseUUIDPipe) discrepancyId: string,
		@Body() dto: ResolveDiscrepancyDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		return this.reconciliation.resolveDiscrepancy(
			requireTenant(tenantId),
			this.requireIdentity(identityId),
			discrepancyId,
			dto.status,
			dto.note,
		);
	}

	private requireIdentity(identityId: string | undefined): string {
		if (identityId === undefined) {
			throw new ForbiddenException("Identity context is required.");
		}
		return identityId;
	}
}
