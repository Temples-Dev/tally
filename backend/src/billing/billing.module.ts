import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { PlanVersion } from "../catalog/entities/plan-version.entity";
import { Plan } from "../catalog/entities/plan.entity";
import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { IdentityModule } from "../identity/identity.module";
import { JobsModule } from "../jobs/jobs.module";
import { CustomerAccount } from "../subscriptions/entities/customer-account.entity";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import { BillingCorrectionsController } from "./billing-corrections.controller";
import { BillingCorrectionsService } from "./billing-corrections.service";
import { BillingInvoiceHandler } from "./billing-invoice.handler";
import { BillingReconciliationController } from "./billing-reconciliation.controller";
import { BillingReconciliationHandler } from "./billing-reconciliation.handler";
import { BillingReconciliationService } from "./billing-reconciliation.service";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { BillingAdjustment } from "./entities/billing-adjustment.entity";
import { BillingCalculation } from "./entities/billing-calculation.entity";
import { BillingDiscrepancy } from "./entities/billing-discrepancy.entity";
import { BillingOperation } from "./entities/billing-operation.entity";
import { BillingPeriod } from "./entities/billing-period.entity";
import { BillingReconciliationRun } from "./entities/billing-reconciliation-run.entity";
import { CreditNoteLine } from "./entities/credit-note-line.entity";
import { CreditNote } from "./entities/credit-note.entity";
import { InvoiceLineItem } from "./entities/invoice-line-item.entity";
import { InvoiceNumberSequence } from "./entities/invoice-number-sequence.entity";
import { Invoice } from "./entities/invoice.entity";
import { Price } from "./entities/price.entity";
import { SubscriptionItem } from "./entities/subscription-item.entity";
import { PricingService } from "./pricing.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			Price,
			SubscriptionItem,
			BillingPeriod,
			BillingOperation,
			BillingAdjustment,
			CreditNote,
			CreditNoteLine,
			BillingReconciliationRun,
			BillingDiscrepancy,
			BillingCalculation,
			Invoice,
			InvoiceLineItem,
			InvoiceNumberSequence,
			Plan,
			PlanVersion,
			Subscription,
			CustomerAccount,
			UsageMetric,
		]),
		IdentityModule,
		JobsModule,
	],
	controllers: [
		BillingController,
		BillingCorrectionsController,
		BillingReconciliationController,
	],
	providers: [
		PricingService,
		BillingService,
		BillingCorrectionsService,
		BillingReconciliationService,
		BillingInvoiceHandler,
		BillingReconciliationHandler,
	],
	exports: [PricingService, BillingService, BillingCorrectionsService],
})
export class BillingModule {}
