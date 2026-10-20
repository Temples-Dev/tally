import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { BillingPeriodStatus } from "../enums";

@Entity("billing_periods")
@Unique(["tenantId", "subscriptionId", "periodStart", "periodEnd"])
export class BillingPeriod {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	subscriptionId: string;

	@Column({ type: "timestamptz" })
	periodStart: Date;

	@Column({ type: "timestamptz" })
	periodEnd: Date;

	@Column({
		type: "enum",
		enum: BillingPeriodStatus,
		default: BillingPeriodStatus.OPEN,
	})
	status: BillingPeriodStatus;

	@Column({ type: "int", default: 1 })
	calculationVersion: number;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	completedAt: Date | null;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
