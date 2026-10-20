import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
} from "typeorm";

import { ReconciliationRunStatus } from "../enums";

@Entity("billing_reconciliation_runs")
@Index(["tenantId", "createdAt"])
export class BillingReconciliationRun {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column({
		type: "enum",
		enum: ReconciliationRunStatus,
		default: ReconciliationRunStatus.RUNNING,
	})
	status: ReconciliationRunStatus;

	@Column({ type: "text", nullable: true })
	requestedBy: string | null;

	@Column({ type: "int", default: 0 })
	invoicesChecked: number;

	@Column({ type: "int", default: 0 })
	discrepanciesFound: number;

	@Column({ type: "text", nullable: true })
	errorCode: string | null;

	@Column({ type: "timestamptz" })
	startedAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	completedAt: Date | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
