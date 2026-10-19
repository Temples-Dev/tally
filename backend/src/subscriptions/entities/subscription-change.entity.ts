import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";

import { ChangeStatus, ChangeType } from "../enums";
import { Subscription } from "./subscription.entity";

@Entity("subscription_changes")
@Index(["tenantId", "subscriptionId", "effectiveAt"])
export class SubscriptionChange {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	subscriptionId: string;

	@ManyToOne(
		() => Subscription,
		(subscription) => subscription.changes,
		{ onDelete: "CASCADE" },
	)
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "subscription_id", referencedColumnName: "id" },
	])
	subscription: Subscription;

	@Column({ type: "enum", enum: ChangeType })
	changeType: ChangeType;

	@Column({ type: "timestamptz" })
	effectiveAt: Date;

	@Column({ type: "jsonb" })
	previousConfiguration: Record<string, unknown>;

	@Column({ type: "jsonb" })
	newConfiguration: Record<string, unknown>;

	@Column({ type: "enum", enum: ChangeStatus, default: ChangeStatus.APPLIED })
	status: ChangeStatus;

	@Column({ type: "timestamptz", nullable: true })
	appliedAt: Date | null;

	@Column({ type: "text", nullable: true })
	actorId: string | null;

	@Column({ type: "text", nullable: true })
	reason: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
