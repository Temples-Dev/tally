import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

@Entity("credit_note_lines")
@Unique(["tenantId", "creditNoteId", "lineNumber"])
@Index(["tenantId", "creditNoteId"])
export class CreditNoteLine {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	creditNoteId: string;

	@Column({ type: "int" })
	lineNumber: number;

	@Column({ type: "uuid", nullable: true })
	invoiceLineId: string | null;

	@Column({ type: "text" })
	description: string;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	amount: string;

	@Column({ type: "jsonb", default: {} })
	metadata: Record<string, unknown>;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
