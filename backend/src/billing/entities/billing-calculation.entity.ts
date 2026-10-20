import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { BillingCalculationStatus } from "../enums";

@Entity("billing_calculations")
@Unique(["tenantId", "billingPeriodId", "calculationVersion"])
export class BillingCalculation {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	subscriptionId: string;

	@Column()
	billingPeriodId: string;

	@Column({ type: "jsonb" })
	pricingVersionReference: Record<string, unknown>;

	@Column({ type: "jsonb" })
	usageSnapshotReference: Record<string, unknown>;

	@Column({ type: "char", length: 3 })
	currency: string;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	subtotal: string;

	@Column({ type: "numeric", precision: 20, scale: 4, default: 0 })
	discountTotal: string;

	@Column({ type: "numeric", precision: 20, scale: 4, default: 0 })
	taxTotal: string;

	@Column({ type: "numeric", precision: 20, scale: 4 })
	total: string;

	@Column({ type: "int" })
	calculationVersion: number;

	@Column({
		type: "enum",
		enum: BillingCalculationStatus,
		default: BillingCalculationStatus.COMPLETED,
	})
	status: BillingCalculationStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
