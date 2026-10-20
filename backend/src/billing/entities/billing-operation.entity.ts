import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { BillingOperationStatus } from "../enums";

@Entity("billing_operations")
@Unique(["tenantId", "idempotencyKey"])
@Index(["tenantId", "status", "createdAt"])
export class BillingOperation {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	operationType: string;

	@Column()
	sourceType: string;

	@Column({ type: "uuid", nullable: true })
	sourceId: string | null;

	@Column()
	idempotencyKey: string;

	@Column({
		type: "enum",
		enum: BillingOperationStatus,
		default: BillingOperationStatus.PENDING,
	})
	status: BillingOperationStatus;

	@Column({ type: "int", default: 0 })
	attemptCount: number;

	@Column({ type: "text", nullable: true })
	lastErrorCode: string | null;

	@Column({ type: "uuid", nullable: true })
	invoiceId: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
