import { Type } from "class-transformer";
import {
	ArrayMinSize,
	IsArray,
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
	ValidateNested,
} from "class-validator";

import { AdjustmentStatus, AdjustmentType } from "./enums";

const AMOUNT_PATTERN = /^\d{1,16}(?:\.\d{1,8})?$/;

export class CreditNoteLineDto {
	@IsOptional()
	@IsUUID()
	invoiceLineId?: string;

	@IsString()
	@MinLength(1)
	@MaxLength(500)
	description: string;

	@IsString()
	@Matches(AMOUNT_PATTERN, {
		message: "amount must be a positive decimal with at most 8 places.",
	})
	amount: string;
}

export class CreateCreditNoteDto {
	@IsString()
	@Matches(AMOUNT_PATTERN, {
		message: "amount must be a positive decimal with at most 8 places.",
	})
	amount: string;

	@IsString()
	@MinLength(1)
	@MaxLength(500)
	reason: string;

	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => CreditNoteLineDto)
	lines?: CreditNoteLineDto[];
}

export class VoidInvoiceDto {
	@IsString()
	@MinLength(1)
	@MaxLength(500)
	reason: string;
}

export class CreateAdjustmentDto {
	@IsUUID()
	customerAccountId: string;

	@IsOptional()
	@IsUUID()
	subscriptionId?: string;

	@IsEnum(AdjustmentType)
	adjustmentType: AdjustmentType;

	@IsString()
	@Matches(AMOUNT_PATTERN, {
		message: "amount must be a positive decimal with at most 8 places.",
	})
	amount: string;

	@IsString()
	@Matches(/^[A-Za-z]{3}$/, { message: "currency must be a 3-letter code." })
	currency: string;

	@IsString()
	@MinLength(1)
	@MaxLength(500)
	reason: string;

	@IsString()
	@MinLength(1)
	@MaxLength(128)
	idempotencyKey: string;
}

export class ListAdjustmentsQueryDto {
	@IsOptional()
	@IsEnum(AdjustmentStatus)
	status?: AdjustmentStatus;

	@IsOptional()
	@IsUUID()
	customerAccountId?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number;
}

export class ListCreditNotesQueryDto {
	@IsOptional()
	@IsUUID()
	invoiceId?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number;
}
