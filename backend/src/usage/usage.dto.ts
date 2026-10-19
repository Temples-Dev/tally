import { Type } from "class-transformer";
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsDateString,
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

import { QUANTITY_PATTERN } from "./usage-payload";

export class IngestUsageEventDto {
	@IsString()
	@MinLength(1)
	@MaxLength(200)
	externalEventId: string;

	@IsString()
	@MinLength(1)
	@MaxLength(100)
	source: string;

	@IsUUID()
	customerAccountId: string;

	@IsOptional()
	@IsUUID()
	subscriptionId?: string;

	@IsUUID()
	metricId: string;

	@IsString()
	@Matches(QUANTITY_PATTERN, {
		message: "quantity must be a decimal with at most 8 fractional digits.",
	})
	quantity: string;

	@IsDateString()
	occurredAt: string;

	@IsOptional()
	@IsObject()
	dimensions?: Record<string, unknown>;
}

export class IngestUsageBatchDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(500)
	events: unknown[];
}

export class UsageSummaryQueryDto {
	@IsUUID()
	metricId: string;

	@IsOptional()
	@IsUUID()
	customerAccountId?: string;

	@IsOptional()
	@IsUUID()
	subscriptionId?: string;

	@IsDateString()
	from: string;

	@IsDateString()
	to: string;
}

export class ListUsageEventsQueryDto {
	@IsOptional()
	@IsUUID()
	metricId?: string;

	@IsOptional()
	@IsUUID()
	customerAccountId?: string;

	@IsOptional()
	@IsUUID()
	subscriptionId?: string;

	@IsOptional()
	@IsDateString()
	from?: string;

	@IsOptional()
	@IsDateString()
	to?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(200)
	limit?: number;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	cursor?: string;
}
