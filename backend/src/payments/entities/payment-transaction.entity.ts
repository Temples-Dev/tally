import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { PaymentTransactionStatus, PaymentTransactionType } from "../enums";

@Entity("payment_transactions")
@Unique([
	"providerAccountId",
	"providerTransactionReference",
	"transactionType",
])
@Index(["tenantId", "invoiceId", "recordedAt"])
export class PaymentTransaction {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column({ type: "uuid" })
	invoiceId: string;

	@Column({ type: "uuid" })
	providerAccountId: string;

	@Column({ type: "uuid", nullable: true })
	paymentAttemptId: string | null;

	@Column({ type: "text" })
	providerTransactionReference: string;

	@Column({ type: "enum", enum: PaymentTransactionType })
	transactionType: PaymentTransactionType;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	amount: string;

	@Column({ type: "char", length: 3 })
	currency: string;

	@Column({ type: "enum", enum: PaymentTransactionStatus })
	status: PaymentTransactionStatus;

	@Column({ type: "timestamptz", nullable: true })
	occurredAt: Date | null;

	@Column({ type: "jsonb", default: {} })
	metadata: Record<string, unknown>;

	@CreateDateColumn({ type: "timestamptz" })
	recordedAt: Date;
}
