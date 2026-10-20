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
	CreateBillingPeriodDto,
	CreatePriceDto,
	CreateSubscriptionItemDto,
	ListBillingPeriodsQueryDto,
	ListInvoicesQueryDto,
} from "./billing.dto";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BillingService } from "./billing.service";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { PricingService } from "./pricing.service";

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
export class BillingController {
	constructor(
		private readonly pricing: PricingService,
		private readonly billing: BillingService,
	) {}

	@Post("plans/:planId/prices")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create an immutable plan price version" })
	@ApiCreatedResponse({ description: "Price created" })
	createPrice(
		@Param("planId", ParseUUIDPipe) planId: string,
		@Body() dto: CreatePriceDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		return this.pricing.createPrice(
			requireTenant(tenantId),
			this.requireIdentity(identityId),
			planId,
			dto,
		);
	}

	@Get("plans/:planId/prices")
	@ApiOperation({ summary: "List plan prices" })
	@ApiOkResponse({ description: "Plan prices" })
	listPrices(
		@Param("planId", ParseUUIDPipe) planId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.pricing.listPrices(requireTenant(tenantId), planId);
	}

	@Post("subscriptions/:subscriptionId/items")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Attach a price to a subscription" })
	@ApiCreatedResponse({ description: "Subscription item created" })
	createItem(
		@Param("subscriptionId", ParseUUIDPipe) subscriptionId: string,
		@Body() dto: CreateSubscriptionItemDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		return this.pricing.createItem(
			requireTenant(tenantId),
			this.requireIdentity(identityId),
			subscriptionId,
			dto,
		);
	}

	@Get("subscriptions/:subscriptionId/items")
	@ApiOperation({ summary: "List subscription items" })
	@ApiOkResponse({ description: "Subscription items" })
	listItems(
		@Param("subscriptionId", ParseUUIDPipe) subscriptionId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.pricing.listItems(requireTenant(tenantId), subscriptionId);
	}

	@Post("billing-periods")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create an idempotent billing period" })
	@ApiCreatedResponse({ description: "Billing period created" })
	createPeriod(
		@Body() dto: CreateBillingPeriodDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		return this.billing.createPeriod(
			requireTenant(tenantId),
			this.requireIdentity(identityId),
			dto,
		);
	}

	@Get("billing-periods")
	@ApiOperation({ summary: "List billing periods" })
	@ApiOkResponse({ description: "Billing periods" })
	listPeriods(
		@Query() query: ListBillingPeriodsQueryDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.billing.listPeriods(requireTenant(tenantId), query);
	}

	@Get("billing-operations/:operationId")
	@ApiOperation({ summary: "Retrieve a billing operation" })
	@ApiOkResponse({ description: "Billing operation" })
	getOperation(
		@Param("operationId", ParseUUIDPipe) operationId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.billing.getOperation(requireTenant(tenantId), operationId);
	}

	@Get("billing-periods/:periodId")
	@ApiOperation({ summary: "Retrieve a billing period" })
	@ApiOkResponse({ description: "Billing period" })
	getPeriod(
		@Param("periodId", ParseUUIDPipe) periodId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.billing.getPeriod(requireTenant(tenantId), periodId);
	}

	@Post("billing-periods/:periodId/invoice")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: "Queue invoice generation for a billing period" })
	@ApiOkResponse({ description: "Invoice queued or already issued" })
	requestInvoice(
		@Param("periodId", ParseUUIDPipe) periodId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.billing.requestInvoice(requireTenant(tenantId), periodId);
	}

	@Get("billing-periods/:periodId/invoice")
	@ApiOperation({ summary: "Retrieve the invoice for a billing period" })
	@ApiOkResponse({ description: "Invoice" })
	getPeriodInvoice(
		@Param("periodId", ParseUUIDPipe) periodId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.billing.getInvoiceForPeriod(requireTenant(tenantId), periodId);
	}

	@Get("invoices")
	@ApiOperation({ summary: "List invoices" })
	@ApiOkResponse({ description: "Invoices" })
	listInvoices(
		@Query() query: ListInvoicesQueryDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.billing.listInvoices(requireTenant(tenantId), query);
	}

	@Get("invoices/:invoiceId")
	@ApiOperation({ summary: "Retrieve an invoice" })
	@ApiOkResponse({ description: "Invoice" })
	getInvoice(
		@Param("invoiceId", ParseUUIDPipe) invoiceId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.billing.getInvoice(requireTenant(tenantId), invoiceId);
	}

	@Get("invoices/:invoiceId/lines")
	@ApiOperation({ summary: "List invoice lines" })
	@ApiOkResponse({ description: "Invoice lines" })
	listLines(
		@Param("invoiceId", ParseUUIDPipe) invoiceId: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.billing.listLines(requireTenant(tenantId), invoiceId);
	}

	private requireIdentity(identityId: string | undefined): string {
		if (identityId === undefined) {
			throw new ForbiddenException("Identity context is required.");
		}
		return identityId;
	}
}
