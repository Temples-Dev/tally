import { Injectable } from "@nestjs/common";

import type { JobHandler } from "./job-handler";

@Injectable()
export class JobRegistry {
	private readonly handlers = new Map<string, JobHandler>();

	register(handler: JobHandler): void {
		const existing = this.handlers.get(handler.jobType);
		if (existing !== undefined && existing !== handler) {
			throw new Error(
				`A handler is already registered for job type ${handler.jobType}.`,
			);
		}
		this.handlers.set(handler.jobType, handler);
	}

	get(jobType: string): JobHandler | undefined {
		return this.handlers.get(jobType);
	}

	registeredTypes(): string[] {
		return [...this.handlers.keys()].sort();
	}
}
