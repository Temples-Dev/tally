import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { CreditNoteStatus } from "../enums";

@Entity("credit_notes")
@Unique(["tenantId", "creditNoteNumber"])
@Unique(["tenantId", "id"])
@Index(["tenantId", "invoiceId", "createdAt"])
export class CreditNote {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	customerAccountId: string;

	@Column()
	invoiceId: string;

	@Column()
	creditNoteNumber: string;

	@Column({ type: "char", length: 3 })
	currency: string;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	amount: string;

	@Column({ type: "text" })
	reason: string;

	@Column({
		type: "enum",
		enum: CreditNoteStatus,
		default: CreditNoteStatus.ISSUED,
	})
	status: CreditNoteStatus;

	@Column({ type: "timestamptz" })
	issuedAt: Date;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
