import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { InvoiceLineType } from "../enums";

@Entity("invoice_line_items")
@Unique(["tenantId", "invoiceId", "lineNumber"])
@Index(["tenantId", "invoiceId"])
export class InvoiceLineItem {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	invoiceId: string;

	@Column({ type: "int" })
	lineNumber: number;

	@Column({ type: "enum", enum: InvoiceLineType })
	lineType: InvoiceLineType;

	@Column({ type: "text" })
	description: string;

	@Column({ type: "numeric", precision: 24, scale: 8 })
	quantity: string;

	@Column({ type: "numeric", precision: 20, scale: 8 })
	unitPrice: string;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	amount: string;

	@Column({ type: "char", length: 3 })
	currency: string;

	@Column({ type: "text", nullable: true })
	sourceType: string | null;

	@Column({ type: "uuid", nullable: true })
	sourceId: string | null;

	@Column({ type: "uuid", nullable: true })
	priceId: string | null;

	@Column({ type: "jsonb", default: {} })
	metadata: Record<string, unknown>;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
