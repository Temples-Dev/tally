import { Module } from "@nestjs/common";

import { JobRunnerService } from "./job-runner.service";
import { JobsModule } from "./jobs.module";

/**
 * Runs durable jobs. Imported only by the worker process so the API does not
 * poll the queue.
 */
@Module({
	imports: [JobsModule],
	providers: [JobRunnerService],
})
export class JobRunnerModule {}
