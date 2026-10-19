import type { BackgroundJob } from "./entities/background-job.entity";

/** A unit of durable work executed by the worker process. */
export interface JobHandler {
	/** Job type this handler owns, for example `usage.aggregate`. */
	readonly jobType: string;
	handle(job: BackgroundJob): Promise<void>;
}

/** Error with a stable machine-readable code recorded on the job. */
export class JobError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "JobError";
	}
}
