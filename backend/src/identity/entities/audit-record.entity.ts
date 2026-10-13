import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
} from "typeorm";

import { ActorType } from "../enums";

@Entity("audit_records")
@Index(["tenantId", "createdAt"])
@Index(["tenantId", "resourceType", "resourceId", "createdAt"])
@Index(["tenantId", "actorId", "createdAt"])
export class AuditRecord {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ type: "text", nullable: true })
	tenantId: string | null;

	@Column({ type: "enum", enum: ActorType })
	actorType: ActorType;

	@Column({ type: "text", nullable: true })
	actorId: string | null;

	@Column()
	action: string;

	@Column()
	resourceType: string;

	@Column()
	resourceId: string;

	@Column({ type: "text", nullable: true })
	reason: string | null;

	@Column({ type: "text", nullable: true })
	correlationId: string | null;

	@Column({ type: "jsonb", default: {} })
	metadata: Record<string, unknown>;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
