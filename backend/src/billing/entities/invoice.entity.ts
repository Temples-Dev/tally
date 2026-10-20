import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { InvoiceStatus } from "../enums";

@Entity("invoices")
@Unique(["tenantId", "invoiceNumber"])
@Index("uq_invoices_billing_period", ["tenantId", "billingPeriodId"], {
	unique: true,
	where: "billing_period_id IS NOT NULL",
})
@Index(["tenantId", "customerAccountId", "createdAt"])
@Index(["tenantId", "status", "dueAt"])
export class Invoice {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	customerAccountId: string;

	@Column({ type: "uuid", nullable: true })
	billingPeriodId: string | null;

	@Column()
	invoiceNumber: string;

	@Column({ type: "jsonb" })
	billingProfileSnapshot: Record<string, unknown>;

	@Column({ type: "char", length: 3 })
	currency: string;

	@Column({ type: "enum", enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
	status: InvoiceStatus;

	@Column({ type: "timestamptz", nullable: true })
	issuedAt: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	dueAt: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	periodStart: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	periodEnd: Date | null;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	subtotal: string;

	@Column({ type: "numeric", precision: 20, scale: 4, default: 0 })
	discountTotal: string;

	@Column({ type: "numeric", precision: 20, scale: 4, default: 0 })
	taxTotal: string;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	total: string;

	@Column({ type: "numeric", precision: 20, scale: 4, default: 0 })
	amountPaid: string;

	@Column({ type: "numeric", precision: 20, scale: 4, default: 0 })
	amountCredited: string;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	amountDue: string;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
