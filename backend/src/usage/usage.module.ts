import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { IdentityModule } from "../identity/identity.module";
import { JobsModule } from "../jobs/jobs.module";
import { CustomerAccount } from "../subscriptions/entities/customer-account.entity";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import { UsageAggregate } from "./entities/usage-aggregate.entity";
import { UsageEvent } from "./entities/usage-event.entity";
import { UsageOperationsService } from "./usage-operations.service";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			UsageEvent,
			UsageAggregate,
			UsageMetric,
			CustomerAccount,
			Subscription,
		]),
		IdentityModule,
		JobsModule,
	],
	controllers: [UsageController],
	providers: [UsageService, UsageOperationsService],
	exports: [UsageService],
})
export class UsageModule {}
