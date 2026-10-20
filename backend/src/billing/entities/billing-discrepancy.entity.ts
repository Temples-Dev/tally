import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
} from "typeorm";

import { DiscrepancyCategory, DiscrepancyStatus } from "../enums";

@Entity("billing_discrepancies")
@Index(["tenantId", "status", "createdAt"])
@Index(["tenantId", "reconciliationRunId", "category"])
export class BillingDiscrepancy {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	reconciliationRunId: string;

	@Column({ type: "enum", enum: DiscrepancyCategory })
	category: DiscrepancyCategory;

	@Column()
	resourceType: string;

	@Column({ type: "uuid", nullable: true })
	resourceId: string | null;

	@Column({ type: "jsonb", default: {} })
	details: Record<string, unknown>;

	@Column({
		type: "enum",
		enum: DiscrepancyStatus,
		default: DiscrepancyStatus.OPEN,
	})
	status: DiscrepancyStatus;

	@Column({ type: "text", nullable: true })
	resolutionNote: string | null;

	@Column({ type: "timestamptz", nullable: true })
	resolvedAt: Date | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
