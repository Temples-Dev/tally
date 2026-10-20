import {
	IsDateString,
	IsEnum,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
} from "class-validator";

import { BillingInterval, InvoiceStatus, PricingModel } from "./enums";

const QUANTITY_PATTERN = /^\d{1,16}(?:\.\d{1,8})?$/;

export class CreatePriceDto {
	@IsString()
	@MinLength(1)
	@MaxLength(64)
	@Matches(/^[A-Za-z0-9_.-]+$/, {
		message:
			"priceCode may contain letters, numbers, dots, dashes, and underscores.",
	})
	priceCode: string;

	@IsString()
	@Matches(/^[A-Za-z]{3}$/, { message: "currency must be a 3-letter code." })
	currency: string;

	@IsEnum(BillingInterval)
	billingInterval: BillingInterval;

	@IsEnum(PricingModel)
	pricingModel: PricingModel;

	@IsObject()
	configuration: Record<string, unknown>;

	@IsOptional()
	@IsDateString()
	effectiveFrom?: string;

	@IsOptional()
	@IsDateString()
	effectiveUntil?: string;

	@IsOptional()
	@IsInt()
	@Min(1)
	versionNumber?: number;
}

export class CreateSubscriptionItemDto {
	@IsUUID()
	priceId: string;

	@IsOptional()
	@IsString()
	@Matches(QUANTITY_PATTERN, {
		message: "quantity must be a positive decimal with at most 8 places.",
	})
	quantity?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	description?: string;
}

export class CreateBillingPeriodDto {
	@IsUUID()
	subscriptionId: string;

	@IsOptional()
	@IsDateString()
	periodStart?: string;

	@IsOptional()
	@IsDateString()
	periodEnd?: string;
}

export class ListInvoicesQueryDto {
	@IsOptional()
	@IsEnum(InvoiceStatus)
	status?: InvoiceStatus;

	@IsOptional()
	@IsUUID()
	customerAccountId?: string;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number;
}
