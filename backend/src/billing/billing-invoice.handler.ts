import { Injectable, type OnModuleInit } from "@nestjs/common";

import type { BackgroundJob } from "../jobs/entities/background-job.entity";
import { JobError, type JobHandler } from "../jobs/job-handler";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { JobRegistry } from "../jobs/job-registry.service";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BILLING_INVOICE_JOB, BillingService } from "./billing.service";

@Injectable()
export class BillingInvoiceHandler implements JobHandler, OnModuleInit {
	readonly jobType = BILLING_INVOICE_JOB;

	constructor(
		private readonly registry: JobRegistry,
		private readonly billing: BillingService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	async handle(job: BackgroundJob): Promise<void> {
		const tenantId = job.payload.tenantId;
		const billingPeriodId = job.payload.billingPeriodId;
		if (
			typeof tenantId !== "string" ||
			tenantId.length === 0 ||
			typeof billingPeriodId !== "string" ||
			billingPeriodId.length === 0
		) {
			throw new JobError(
				"The invoice generation payload is invalid.",
				"INVALID_PAYLOAD",
			);
		}
		await this.billing.generateInvoice(tenantId, billingPeriodId);
	}
}
