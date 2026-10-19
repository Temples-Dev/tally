import { Injectable, type OnModuleInit } from "@nestjs/common";

import type { BackgroundJob } from "../jobs/entities/background-job.entity";
import { JobError, type JobHandler } from "../jobs/job-handler";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { JobRegistry } from "../jobs/job-registry.service";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { QuotasService } from "./quotas.service";
import { QUOTA_RESERVATION_EXPIRE_JOB } from "./quotas.service";

@Injectable()
export class QuotaExpirationHandler implements JobHandler, OnModuleInit {
	readonly jobType = QUOTA_RESERVATION_EXPIRE_JOB;

	constructor(
		private readonly registry: JobRegistry,
		private readonly quotas: QuotasService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	async handle(job: BackgroundJob): Promise<void> {
		const reservationId = job.payload.reservationId;
		if (typeof reservationId !== "string" || reservationId.length === 0) {
			throw new JobError(
				"The quota reservation payload is invalid.",
				"INVALID_PAYLOAD",
			);
		}
		await this.quotas.expireReservation(reservationId);
	}
}
