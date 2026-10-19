import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { IdentityModule } from "../identity/identity.module";
import { JobsModule } from "../jobs/jobs.module";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import { QuotaPolicy } from "./entities/quota-policy.entity";
import { QuotaReservation } from "./entities/quota-reservation.entity";
import { QuotaUsageCounter } from "./entities/quota-usage-counter.entity";
import { QuotaExpirationHandler } from "./quota-expiration.handler";
import { QuotasController } from "./quotas.controller";
import { QuotasService } from "./quotas.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			QuotaPolicy,
			QuotaUsageCounter,
			QuotaReservation,
			UsageMetric,
			Subscription,
		]),
		IdentityModule,
		JobsModule,
	],
	controllers: [QuotasController],
	providers: [QuotasService, QuotaExpirationHandler],
	exports: [QuotasService],
})
export class QuotasModule {}
