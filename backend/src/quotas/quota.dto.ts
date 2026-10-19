import {
	IsBoolean,
	IsDateString,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
} from "class-validator";

import {
	QuotaEnforcementMode,
	QuotaOveragePolicy,
	QuotaWindowType,
} from "./enums";

const AMOUNT_PATTERN = /^\d{1,16}(?:\.\d{1,8})?$/;

export class CreateQuotaPolicyDto {
	@IsUUID()
	subscriptionId: string;

	@IsUUID()
	metricId: string;

	@IsOptional()
	@IsString()
	@Matches(AMOUNT_PATTERN, {
		message: "limitValue must be a non-negative decimal with at most 8 places.",
	})
	limitValue?: string;

	@IsOptional()
	@IsBoolean()
	unmetered?: boolean;

	@IsEnum(QuotaWindowType)
	windowType: QuotaWindowType;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(100_000)
	windowSize?: number;

	@IsOptional()
	@IsEnum(QuotaEnforcementMode)
	enforcementMode?: QuotaEnforcementMode;

	@IsOptional()
	@IsEnum(QuotaOveragePolicy)
	overagePolicy?: QuotaOveragePolicy;

	@IsOptional()
	@IsDateString()
	effectiveFrom?: string;

	@IsOptional()
	@IsDateString()
	effectiveUntil?: string;
}

export class UpdateQuotaPolicyDto {
	@IsOptional()
	@IsString()
	@Matches(AMOUNT_PATTERN, {
		message: "limitValue must be a non-negative decimal with at most 8 places.",
	})
	limitValue?: string;

	@IsOptional()
	@IsBoolean()
	unmetered?: boolean;

	@IsOptional()
	@IsEnum(QuotaWindowType)
	windowType?: QuotaWindowType;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(100_000)
	windowSize?: number;

	@IsOptional()
	@IsEnum(QuotaEnforcementMode)
	enforcementMode?: QuotaEnforcementMode;

	@IsOptional()
	@IsEnum(QuotaOveragePolicy)
	overagePolicy?: QuotaOveragePolicy;

	@IsOptional()
	@IsDateString()
	effectiveFrom?: string;

	@IsOptional()
	@IsDateString()
	effectiveUntil?: string;
}

export class CreateReservationDto {
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	key: string;

	@IsString()
	@Matches(AMOUNT_PATTERN, {
		message: "amount must be a positive decimal with at most 8 places.",
	})
	amount: string;

	@IsString()
	@MinLength(1)
	@MaxLength(200)
	operationId: string;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(86_400)
	ttlSeconds?: number;

	@IsOptional()
	@IsDateString()
	expiresAt?: string;
}

export class CommitReservationDto {
	@IsOptional()
	@IsString()
	@Matches(/^\d{1,16}(?:\.\d{1,8})?$/, {
		message: "amount must be a non-negative decimal with at most 8 places.",
	})
	amount?: string;
}
