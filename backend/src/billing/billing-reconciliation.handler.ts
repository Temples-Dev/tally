import { Injectable, type OnModuleInit } from "@nestjs/common";

import type { BackgroundJob } from "../jobs/entities/background-job.entity";
import { JobError } from "../jobs/job-handler";
import type { JobHandler } from "../jobs/job-handler";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { JobRegistry } from "../jobs/job-registry.service";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import {
	BILLING_RECONCILIATION_JOB,
	BillingReconciliationService,
} from "./billing-reconciliation.service";

@Injectable()
export class BillingReconciliationHandler implements JobHandler, OnModuleInit {
	readonly jobType = BILLING_RECONCILIATION_JOB;

	constructor(
		private readonly reconciliation: BillingReconciliationService,
		private readonly registry: JobRegistry,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	async handle(job: BackgroundJob): Promise<void> {
		const tenantId = job.payload.tenantId;
		const reconciliationRunId = job.payload.reconciliationRunId;
		if (
			typeof tenantId !== "string" ||
			typeof reconciliationRunId !== "string"
		) {
			throw new JobError(
				"The reconciliation job payload is invalid.",
				"INVALID_PAYLOAD",
			);
		}
		await this.reconciliation.execute(tenantId, reconciliationRunId);
	}
}
