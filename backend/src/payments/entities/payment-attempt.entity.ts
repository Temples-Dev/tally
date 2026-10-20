import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { PaymentAttemptStatus } from "../enums";

@Entity("payment_attempts")
@Unique(["tenantId", "providerAccountId", "idempotencyKey"])
@Unique(["providerReference"])
@Index(["tenantId", "invoiceId", "createdAt"])
@Index(["tenantId", "status", "createdAt"])
export class PaymentAttempt {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column({ type: "uuid" })
	invoiceId: string;

	@Column({ type: "uuid" })
	providerAccountId: string;

	@Column({ type: "text" })
	idempotencyKey: string;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	amount: string;

	@Column({ type: "char", length: 3 })
	currency: string;

	@Column({
		type: "enum",
		enum: PaymentAttemptStatus,
		default: PaymentAttemptStatus.PENDING,
	})
	status: PaymentAttemptStatus;

	@Column({ type: "text" })
	providerReference: string;

	@Column({ type: "text", nullable: true })
	checkoutUrl: string | null;

	@Column({ type: "text", nullable: true })
	failureCode: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	completedAt: Date | null;
}
