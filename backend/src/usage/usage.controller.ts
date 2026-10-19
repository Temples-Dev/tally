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
	Res,
	UseGuards,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";

import { CurrentTenantId } from "../identity/decorators";
import { MemberRole } from "../identity/enums";
import { Roles } from "../identity/roles.decorator";
import { TenantGuard } from "../identity/tenant.guard";
// biome-ignore lint/style/useImportType: DTO classes must be value imports for decorator metadata.
import {
	IngestUsageBatchDto,
	IngestUsageEventDto,
	ListUsageEventsQueryDto,
} from "./usage.dto";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { UsageService } from "./usage.service";

function requireTenant(tenantId: string | undefined): string {
	if (tenantId === undefined) {
		throw new ForbiddenException("Tenant context is required.");
	}
	return tenantId;
}

@ApiTags("usage")
@ApiBearerAuth()
@Controller()
@UseGuards(TenantGuard)
export class UsageController {
	constructor(private readonly usage: UsageService) {}

	@Post("usage/events")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR, MemberRole.DEVELOPER)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: "Submit a usage event idempotently" })
	@ApiCreatedResponse({ description: "Usage event accepted" })
	async ingestEvent(
		@Body() dto: IngestUsageEventDto,
		@Res({ passthrough: true }) response: Response,
		@CurrentTenantId() tenantId?: string,
	) {
		const outcome = await this.usage.ingest(requireTenant(tenantId), dto);
		response.status(
			outcome.status === "accepted" ? HttpStatus.CREATED : HttpStatus.OK,
		);
		return {
			status: outcome.status,
			event: this.usage.toBody(outcome.event),
		};
	}

	@Post("usage/events/batch")
	@Roles(MemberRole.OWNER, MemberRole.ADMINISTRATOR, MemberRole.DEVELOPER)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Submit usage events with per-event outcomes" })
	@ApiOkResponse({ description: "Per-event ingestion results" })
	async ingestBatch(
		@Body() dto: IngestUsageBatchDto,
		@CurrentTenantId() tenantId?: string,
	) {
		const results = await this.usage.ingestBatch(
			requireTenant(tenantId),
			dto.events,
		);
		return { results };
	}

	@Get("usage/events")
	@ApiOperation({ summary: "List usage events" })
	@ApiOkResponse({ description: "Paginated usage events" })
	listEvents(
		@Query() query: ListUsageEventsQueryDto,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.usage.listEvents(requireTenant(tenantId), query);
	}

	@Get("usage/events/:id")
	@ApiOperation({ summary: "Retrieve one usage event" })
	@ApiOkResponse({ description: "Usage event" })
	async getEvent(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentTenantId() tenantId?: string,
	) {
		return this.usage.getEvent(requireTenant(tenantId), id);
	}
}
