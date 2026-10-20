import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { BillingModule } from "./billing/billing.module";
import { validateEnvironment } from "./config/environment.validation";
import { typeOrmOptions } from "./database/typeorm-options";
import { JobRunnerModule } from "./jobs/job-runner.module";
import { QuotasModule } from "./quotas/quotas.module";
import { UsageAggregationModule } from "./usage/aggregation/usage-aggregation.module";
import { WorkerHealthModule } from "./worker/worker-health.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validate: validateEnvironment,
		}),
		TypeOrmModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: typeOrmOptions,
			inject: [ConfigService],
		}),
		JobRunnerModule,
		UsageAggregationModule,
		QuotasModule,
		BillingModule,
		WorkerHealthModule,
	],
})
export class WorkerModule {}
