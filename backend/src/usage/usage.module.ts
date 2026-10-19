import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { IdentityModule } from "../identity/identity.module";
import { CustomerAccount } from "../subscriptions/entities/customer-account.entity";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import { UsageEvent } from "./entities/usage-event.entity";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			UsageEvent,
			UsageMetric,
			CustomerAccount,
			Subscription,
		]),
		IdentityModule,
	],
	controllers: [UsageController],
	providers: [UsageService],
	exports: [UsageService],
})
export class UsageModule {}
