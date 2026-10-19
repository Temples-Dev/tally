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
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	Min,
	MinLength,
} from "class-validator";

import { CurrentIdentityId, CurrentTenantId } from "../identity/decorators";
import { MemberRole } from "../identity/enums";
import { Roles } from "../identity/roles.decorator";
import { TenantGuard } from "../identity/tenant.guard";
import type { Subscription } from "./entities/subscription.entity";
import { CancelMode, EffectiveMode } from "./enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { SubscriptionsService } from "./subscriptions.service";

export class CreateCustomerDto {
	@IsString()
	@MinLength(2)
	@MaxLength(200)
	displayName: string;

	@IsOptional()
	@IsString()
	email?: string;

	@IsOptional()
	@IsString()
	externalCustomerRef?: string;
}

export class CreateSubscriptionDto {
	@IsUUID()
	customerAccountId: string;

	@IsUUID()
	planVersionId: string;

	@IsOptional()
	@IsInt()
	@Min(0)
	trialDays?: number;
}

export class CancelSubscriptionDto {
	@IsEnum(CancelMode)
	mode: CancelMode;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	reason?: string;
}

export class PlanChangeDto {
	@IsUUID()
	targetPlanVersionId: string;

	@IsEnum(EffectiveMode)
	effectiveMode: EffectiveMode;
}

function subscriptionBody(subscription: Subscription) {
	return {
		id: subscription.id,
		tenantId: subscription.tenantId,
		customerAccountId: subscription.customerAccountId,
		productId: subscription.productId,
		planVersionId: subscription.planVersionId,
		status: subscription.status,
		startedAt: subscription.startedAt?.toISOString() ?? null,
		currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
		currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
		trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
		cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
		cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
		createdAt: subscription.createdAt.toISOString(),
		updatedAt: subscription.updatedAt.toISOString(),
	};
}

function requireIdentity(identityId: string | undefined): string {
	if (identityId === undefined) {
		throw new ForbiddenException("Missing authenticated identity.");
	}
	return identityId;
}

@ApiTags("subscriptions")
@ApiBearerAuth()
@Controller()
@UseGuards(TenantGuard)
export class SubscriptionsController {
	constructor(private readonly subscriptions: SubscriptionsService) {}

	private assertTenant(
		pathTenantId: string,
		contextTenantId: string | undefined,
	): string {
		const resolved = contextTenantId;
		if (resolved === undefined || resolved !== pathTenantId) {
			throw new ForbiddenException("Tenant mismatch.");
		}
		return resolved;
	}

	@Post("customers")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a customer account" })
	@ApiCreatedResponse({ description: "Customer account created" })
	createCustomer(
		@Body() dto: CreateCustomerDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.subscriptions.createCustomer(requireTenant(tenantId), dto);
	}

	@Get("customers")
	@ApiOperation({ summary: "List customer accounts" })
	@ApiOkResponse({ description: "Customer list" })
	listCustomers(@CurrentTenantId() tenantId?: string) {
		return this.subscriptions.listCustomers(requireTenant(tenantId));
	}

	@Post("subscriptions")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Create a subscription" })
	@ApiCreatedResponse({ description: "Subscription created" })
	async createSubscription(
		@Body() dto: CreateSubscriptionDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		const subscription = await this.subscriptions.createSubscription(
			requireTenant(tenantId),
			requireIdentity(identityId),
			dto,
		);
		return subscriptionBody(subscription);
	}

	@Get("subscriptions/:id")
	@ApiOperation({ summary: "Retrieve a subscription" })
	@ApiOkResponse({ description: "Subscription details" })
	async getSubscription(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return subscriptionBody(
			await this.subscriptions.requireSubscription(requireTenant(tenantId), id),
		);
	}

	@Get("tenants/:tenantId/subscriptions")
	@ApiOperation({ summary: "List tenant subscriptions" })
	@ApiOkResponse({ description: "Subscription list" })
	listTenantSubscriptions(
		@Param("tenantId", ParseUUIDPipe) tenantId: string,
		@CurrentTenantId() contextTenantId?: string,
	) {
		return this.subscriptions.listSubscriptions(
			this.assertTenant(tenantId, contextTenantId),
		);
	}

	@Post("subscriptions/:id/cancel")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: "Cancel a subscription immediately or at period end",
	})
	@ApiOkResponse({ description: "Subscription cancelled or scheduled" })
	async cancelSubscription(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: CancelSubscriptionDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		const subscription = await this.subscriptions.cancel(
			requireTenant(tenantId),
			id,
			dto.mode,
			requireIdentity(identityId),
			dto.reason ?? null,
		);
		return subscriptionBody(subscription);
	}

	@Post("subscriptions/:id/resume")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: "Resume a paused, trialing, or past-due subscription",
	})
	@ApiOkResponse({ description: "Subscription resumed" })
	async resumeSubscription(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		const subscription = await this.subscriptions.resume(
			requireTenant(tenantId),
			id,
			requireIdentity(identityId),
		);
		return subscriptionBody(subscription);
	}

	@Post("subscriptions/:id/plan-changes")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: "Request a plan change, immediate or at period end",
	})
	@ApiOkResponse({ description: "Plan change recorded" })
	async requestPlanChange(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: PlanChangeDto,
		@CurrentTenantId() tenantId?: string,
		@CurrentIdentityId() identityId?: string,
	) {
		const subscription = await this.subscriptions.requestPlanChange(
			requireTenant(tenantId),
			id,
			dto.targetPlanVersionId,
			dto.effectiveMode,
			requireIdentity(identityId),
		);
		return subscriptionBody(subscription);
	}

	@Get("subscriptions/:id/history")
	@ApiOperation({ summary: "Subscription change history" })
	@ApiOkResponse({ description: "Chronological history" })
	history(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.subscriptions.history(requireTenant(tenantId), id);
	}
}

function requireTenant(tenantId: string | undefined): string {
	if (tenantId === undefined) {
		throw new ForbiddenException("Tenant context is required.");
	}
	return tenantId;
}
