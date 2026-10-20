import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("invoice_number_sequences")
export class InvoiceNumberSequence {
	@PrimaryColumn("uuid")
	tenantId: string;

	@Column({ type: "bigint", default: 1 })
	nextNumber: string;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
