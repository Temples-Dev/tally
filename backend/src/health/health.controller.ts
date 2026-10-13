import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { Public } from "../identity/public.decorator";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { HealthService, HealthStatus } from "./health.service";

@ApiTags("health")
@Controller("health")
@Public()
export class HealthController {
	constructor(private readonly healthService: HealthService) {}

	@Get()
	@ApiOperation({ summary: "Full health status including dependencies" })
	@ApiResponse({ status: 200, description: "Service health status" })
	async check(): Promise<HealthStatus> {
		return this.healthService.check();
	}

	@Get("ready")
	@ApiOperation({ summary: "Readiness check for traffic routing" })
	@ApiResponse({ status: 200, description: "Service is ready" })
	@ApiResponse({ status: 503, description: "Service is not ready" })
	async ready(): Promise<{ status: string }> {
		const isReady = await this.healthService.isReady();
		return { status: isReady ? "ready" : "not_ready" };
	}

	@Get("live")
	@ApiOperation({ summary: "Liveness check" })
	@ApiResponse({ status: 200, description: "Process is alive" })
	live(): { status: string } {
		return { status: "alive" };
	}
}
