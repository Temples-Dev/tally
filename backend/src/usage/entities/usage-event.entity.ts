import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { UsageEventStatus } from "../enums";

@Entity("usage_events")
@Unique(["tenantId", "source", "externalEventId"])
@Index(["tenantId", "metricId", "occurredAt"])
@Index(["tenantId", "customerAccountId", "occurredAt"])
@Index(["tenantId", "subscriptionId", "occurredAt"])
export class UsageEvent {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	source: string;

	@Column()
	externalEventId: string;

	@Column()
	customerAccountId: string;

	@Column({ type: "uuid", nullable: true })
	subscriptionId: string | null;

	@Column()
	metricId: string;

	@Column({ type: "numeric", precision: 24, scale: 8 })
	quantity: string;

	@Column({ type: "jsonb", default: {} })
	dimensions: Record<string, unknown>;

	@Column({ type: "timestamptz" })
	occurredAt: Date;

	@Column({ type: "timestamptz" })
	receivedAt: Date;

	@Column()
	payloadHash: string;

	@Column({
		type: "enum",
		enum: UsageEventStatus,
		default: UsageEventStatus.ACCEPTED,
	})
	status: UsageEventStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
