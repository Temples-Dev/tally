import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { PlanVersion } from "../catalog/entities/plan-version.entity";
import { Plan } from "../catalog/entities/plan.entity";
import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { IdentityModule } from "../identity/identity.module";
import { JobsModule } from "../jobs/jobs.module";
import { CustomerAccount } from "../subscriptions/entities/customer-account.entity";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import { BillingInvoiceHandler } from "./billing-invoice.handler";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { BillingCalculation } from "./entities/billing-calculation.entity";
import { BillingPeriod } from "./entities/billing-period.entity";
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
	controllers: [BillingController],
	providers: [PricingService, BillingService, BillingInvoiceHandler],
	exports: [PricingService, BillingService],
})
export class BillingModule {}
