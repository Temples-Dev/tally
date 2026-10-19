import { Injectable, type OnModuleInit } from "@nestjs/common";

import type { BackgroundJob } from "../../jobs/entities/background-job.entity";
import { JobError, type JobHandler } from "../../jobs/job-handler";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { JobRegistry } from "../../jobs/job-registry.service";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { UsageAggregationService } from "./usage-aggregation.service";
import {
	USAGE_AGGREGATION_JOB,
	type UsageAggregationJobPayload,
} from "./usage-aggregation.types";

@Injectable()
export class UsageAggregationHandler implements JobHandler, OnModuleInit {
	readonly jobType = USAGE_AGGREGATION_JOB;

	constructor(
		private readonly registry: JobRegistry,
		private readonly aggregation: UsageAggregationService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	async handle(job: BackgroundJob): Promise<void> {
		const payload = this.parse(job.payload);
		const periodStart = new Date(payload.periodStart);
		const periodEnd = new Date(payload.periodEnd);
		if (
			Number.isNaN(periodStart.getTime()) ||
			Number.isNaN(periodEnd.getTime()) ||
			periodEnd.getTime() <= periodStart.getTime()
		) {
			throw new JobError(
				"The aggregation period is invalid.",
				"INVALID_PAYLOAD",
			);
		}
		await this.aggregation.recompute({
			tenantId: payload.tenantId,
			customerAccountId: payload.customerAccountId,
			subscriptionId: payload.subscriptionId,
			metricId: payload.metricId,
			periodStart,
			periodEnd,
			dimensions: payload.dimensions,
		});
	}

	private parse(raw: Record<string, unknown>): UsageAggregationJobPayload {
		const dimensions = raw.dimensions ?? {};
		if (
			typeof raw.tenantId !== "string" ||
			typeof raw.customerAccountId !== "string" ||
			typeof raw.metricId !== "string" ||
			typeof raw.periodStart !== "string" ||
			typeof raw.periodEnd !== "string" ||
			(raw.subscriptionId !== null &&
				raw.subscriptionId !== undefined &&
				typeof raw.subscriptionId !== "string") ||
			typeof dimensions !== "object" ||
			dimensions === null ||
			Array.isArray(dimensions)
		) {
			throw new JobError(
				"The aggregation payload is invalid.",
				"INVALID_PAYLOAD",
			);
		}
		return {
			tenantId: raw.tenantId,
			customerAccountId: raw.customerAccountId,
			subscriptionId: (raw.subscriptionId as string | null) ?? null,
			metricId: raw.metricId,
			periodStart: raw.periodStart,
			periodEnd: raw.periodEnd,
			dimensions: dimensions as Record<string, unknown>,
		};
	}
}
