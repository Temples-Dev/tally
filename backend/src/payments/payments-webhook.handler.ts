import { Injectable, type OnModuleInit } from "@nestjs/common";

import type { BackgroundJob } from "../jobs/entities/background-job.entity";
import { JobError, type JobHandler } from "../jobs/job-handler";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { JobRegistry } from "../jobs/job-registry.service";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { PAYMENTS_WEBHOOK_JOB, PaymentsService } from "./payments.service";

@Injectable()
export class PaymentsWebhookHandler implements JobHandler, OnModuleInit {
	readonly jobType = PAYMENTS_WEBHOOK_JOB;

	constructor(
		private readonly registry: JobRegistry,
		private readonly payments: PaymentsService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	async handle(job: BackgroundJob): Promise<void> {
		const eventId = job.payload.eventId;
		if (typeof eventId !== "string" || eventId.length === 0) {
			throw new JobError(
				"The payment webhook payload is invalid.",
				"INVALID_PAYLOAD",
			);
		}
		await this.payments.processWebhookEvent(eventId);
	}
}
