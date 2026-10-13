import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager, Repository } from "typeorm";

import { AuditRecord } from "./entities/audit-record.entity";
import type { ActorType } from "./enums";

export interface AuditInput {
	tenantId?: string | null;
	actorType: ActorType;
	actorId?: string | null;
	action: string;
	resourceType: string;
	resourceId: string;
	reason?: string | null;
	correlationId?: string | null;
	metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN =
	/secret|token|password|authorization|apikey|api_key|private/i;

/** Removes secret-bearing keys so audit payloads never carry credentials. */
export function scrubMetadata(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	const scrubbed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (SENSITIVE_KEY_PATTERN.test(key)) {
			scrubbed[key] = "[redacted]";
		} else if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value)
		) {
			scrubbed[key] = scrubMetadata(value as Record<string, unknown>);
		} else {
			scrubbed[key] = value;
		}
	}
	return scrubbed;
}

@Injectable()
export class AuditService {
	private readonly logger = new Logger(AuditService.name);

	constructor(
		@InjectRepository(AuditRecord)
		private readonly records: Repository<AuditRecord>,
	) {}

	/**
	 * Records an audit event. Pass a transactional manager to commit the record
	 * atomically with the business operation it describes.
	 */
	async record(
		input: AuditInput,
		manager?: EntityManager,
	): Promise<AuditRecord> {
		const repository =
			manager === undefined ? this.records : manager.getRepository(AuditRecord);
		const record = repository.create({
			tenantId: input.tenantId ?? null,
			actorType: input.actorType,
			actorId: input.actorId ?? null,
			action: input.action,
			resourceType: input.resourceType,
			resourceId: input.resourceId,
			reason: input.reason ?? null,
			correlationId: input.correlationId ?? null,
			metadata: scrubMetadata(input.metadata ?? {}),
		});
		return repository.save(record);
	}

	/** Best-effort audit for paths (like guard denials) that must not fail the request. */
	async recordSafely(input: AuditInput): Promise<void> {
		try {
			await this.record(input);
		} catch (error: unknown) {
			this.logger.warn(
				`Audit record dropped: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
