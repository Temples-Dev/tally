import { Type } from "class-transformer";
import {
	IsEnum,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min,
	MinLength,
} from "class-validator";

import { DiscrepancyStatus } from "./enums";

export class ListDiscrepanciesQueryDto {
	@IsOptional()
	@IsEnum(DiscrepancyStatus)
	status?: DiscrepancyStatus;

	@IsOptional()
	@IsUUID()
	runId?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number;
}

export class ResolveDiscrepancyDto {
	@IsIn([DiscrepancyStatus.RESOLVED, DiscrepancyStatus.IGNORED])
	status: DiscrepancyStatus;

	@IsString()
	@MinLength(1)
	@MaxLength(500)
	note: string;
}
