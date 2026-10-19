import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { BackgroundJobsService } from "./background-jobs.service";
import { BackgroundJob } from "./entities/background-job.entity";
import { JobRegistry } from "./job-registry.service";

@Module({
	imports: [TypeOrmModule.forFeature([BackgroundJob])],
	providers: [BackgroundJobsService, JobRegistry],
	exports: [BackgroundJobsService, JobRegistry],
})
export class JobsModule {}
