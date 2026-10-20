import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { AdjustmentStatus, AdjustmentType } from "../enums";

@Entity("billing_adjustments")
@Unique(["tenantId", "idempotencyKey"])
@Index(["tenantId", "customerAccountId", "status", "createdAt"])
export class BillingAdjustment {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	customerAccountId: string;

	@Column({ type: "uuid", nullable: true })
	subscriptionId: string | null;

	@Column({ type: "uuid", nullable: true })
	invoiceId: string | null;

	@Column({ type: "enum", enum: AdjustmentType })
	adjustmentType: AdjustmentType;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	amount: string;

	@Column({ type: "char", length: 3 })
	currency: string;

	@Column({ type: "text" })
	reason: string;

	@Column({
		type: "enum",
		enum: AdjustmentStatus,
		default: AdjustmentStatus.PENDING,
	})
	status: AdjustmentStatus;

	@Column()
	idempotencyKey: string;

	@Column({ type: "text", nullable: true })
	createdBy: string | null;

	@Column({ type: "timestamptz", nullable: true })
	appliedAt: Date | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
