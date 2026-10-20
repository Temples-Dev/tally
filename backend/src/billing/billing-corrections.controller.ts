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
	CreateAdjustmentDto,
	CreateCreditNoteDto,
	ListAdjustmentsQueryDto,
	ListCreditNotesQueryDto,
	VoidInvoiceDto,
} from "./billing-corrections.dto";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BillingCorrectionsService } from "./billing-corrections.service";

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
export class BillingCorrectionsController {
	constructor(private readonly corrections: BillingCorrectionsService) {}

	@Post("invoices/:invoiceId/credit-notes")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Issue a credit note against an invoice" })
	@ApiCreatedResponse({ description: "Credit note issued" })
	createCreditNote(
		@Param("invoiceId", ParseUUIDPipe) invoiceId: string,
		@Body() dto: CreateCreditNoteDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		return this.corrections.createCreditNote(
			requireTenant(tenantId),
			this.requireIdentity(identityId),
			invoiceId,
			dto,
		);
	}

	@Get("credit-notes")
	@ApiOperation({ summary: "List credit notes" })
	@ApiOkResponse({ description: "Credit notes" })
	listCreditNotes(
		@Query() query: ListCreditNotesQueryDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.corrections.listCreditNotes(requireTenant(tenantId), query);
	}

	@Get("credit-notes/:creditNoteId")
	@ApiOperation({ summary: "Retrieve a credit note" })
	@ApiOkResponse({ description: "Credit note" })
	getCreditNote(
		@Param("creditNoteId", ParseUUIDPipe) creditNoteId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.corrections.getCreditNote(
			requireTenant(tenantId),
			creditNoteId,
		);
	}

	@Post("invoices/:invoiceId/void")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Void an open invoice" })
	@ApiOkResponse({ description: "Invoice voided" })
	voidInvoice(
		@Param("invoiceId", ParseUUIDPipe) invoiceId: string,
		@Body() dto: VoidInvoiceDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		return this.corrections.voidInvoice(
			requireTenant(tenantId),
			this.requireIdentity(identityId),
			invoiceId,
			dto,
		);
	}

	@Post("billing-adjustments")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a pending billing adjustment" })
	@ApiCreatedResponse({ description: "Adjustment created" })
	createAdjustment(
		@Body() dto: CreateAdjustmentDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		return this.corrections.createAdjustment(
			requireTenant(tenantId),
			this.requireIdentity(identityId),
			dto,
		);
	}

	@Get("billing-adjustments")
	@ApiOperation({ summary: "List billing adjustments" })
	@ApiOkResponse({ description: "Billing adjustments" })
	listAdjustments(
		@Query() query: ListAdjustmentsQueryDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.corrections.listAdjustments(requireTenant(tenantId), query);
	}

	private requireIdentity(identityId: string | undefined): string {
		if (identityId === undefined) {
			throw new ForbiddenException("Identity context is required.");
		}
		return identityId;
	}
}
