import {
	BadGatewayException,
	Body,
	Controller,
	Get,
	Headers,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	type RawBodyRequest,
	Req,
	UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { CurrentIdentityId, CurrentTenantId } from "../identity/decorators";
import { MemberRole } from "../identity/enums";
import { Public } from "../identity/public.decorator";
import { Roles } from "../identity/roles.decorator";
import { TenantGuard } from "../identity/tenant.guard";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { PaymentProviderAccountsService } from "./payment-provider-accounts.service";
// biome-ignore lint/style/useImportType: DTO metadata drives request validation.
import {
	ConfigurePaymentProviderDto,
	InitiatePaymentDto,
} from "./payments.dto";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { PaymentsService } from "./payments.service";

@Controller()
export class PaymentsController {
	constructor(
		private readonly payments: PaymentsService,
		private readonly accounts: PaymentProviderAccountsService,
	) {}

	@Get("payment-provider-accounts")
	@UseGuards(TenantGuard)
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	listProviderAccounts(@CurrentTenantId() tenantId: string) {
		return this.accounts.list(tenantId);
	}

	@Post("payment-provider-accounts")
	@UseGuards(TenantGuard)
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	configureProviderAccount(
		@CurrentTenantId() tenantId: string,
		@CurrentIdentityId() identityId: string,
		@Body() dto: ConfigurePaymentProviderDto,
	) {
		return this.accounts.configure(tenantId, identityId, dto);
	}

	@Post("invoices/:invoiceId/payments")
	@UseGuards(TenantGuard)
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	async initiate(
		@CurrentTenantId() tenantId: string,
		@CurrentIdentityId() identityId: string,
		@Param("invoiceId", new ParseUUIDPipe()) invoiceId: string,
		@Body() dto: InitiatePaymentDto,
		@Headers("idempotency-key") headerKey: string | undefined,
	) {
		const result = await this.payments.initiate(
			tenantId,
			identityId,
			invoiceId,
			headerKey ?? dto.idempotencyKey ?? "",
			dto,
		);
		if (result.providerError !== null) {
			throw new BadGatewayException({
				code: result.providerError.code,
				message: "The payment provider could not start the checkout.",
			});
		}
		return result.attempt;
	}

	@Get("payments/:paymentId")
	@UseGuards(TenantGuard)
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	getPayment(
		@CurrentTenantId() tenantId: string,
		@Param("paymentId", new ParseUUIDPipe()) paymentId: string,
	) {
		return this.payments.get(tenantId, paymentId);
	}

	@Public()
	@Post("webhooks/payments/paystack")
	@HttpCode(200)
	handlePaystackWebhook(
		@Req() request: RawBodyRequest<Request>,
		@Headers("x-paystack-signature") signature: string | undefined,
	) {
		const rawBody = request.rawBody;
		if (rawBody === undefined) {
			throw new BadGatewayException("Raw webhook body is unavailable.");
		}
		return this.payments.handlePaystackWebhook(rawBody, signature);
	}
}
