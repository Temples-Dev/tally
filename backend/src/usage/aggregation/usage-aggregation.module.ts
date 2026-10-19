import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { UsageMetric } from "../../catalog/entities/usage-metric.entity";
import { JobsModule } from "../../jobs/jobs.module";
import { UsageAggregate } from "../entities/usage-aggregate.entity";
import { UsageEvent } from "../entities/usage-event.entity";
import { UsageAggregationHandler } from "./usage-aggregation.handler";
import { UsageAggregationService } from "./usage-aggregation.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([UsageAggregate, UsageEvent, UsageMetric]),
		JobsModule,
	],
	providers: [UsageAggregationService, UsageAggregationHandler],
	exports: [UsageAggregationService],
})
export class UsageAggregationModule {}
