import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { BillingInterval, PriceStatus, PricingModel } from "../enums";

@Entity("prices")
@Unique(["tenantId", "planId", "priceCode", "versionNumber"])
export class Price {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	planId: string;

	@Column()
	priceCode: string;

	@Column()
	versionNumber: number;

	@Column({ type: "char", length: 3 })
	currency: string;

	@Column({ type: "enum", enum: BillingInterval })
	billingInterval: BillingInterval;

	@Column({ type: "enum", enum: PricingModel })
	pricingModel: PricingModel;

	@Column({ type: "timestamptz" })
	effectiveFrom: Date;

	@Column({ type: "timestamptz", nullable: true })
	effectiveUntil: Date | null;

	@Column({ type: "jsonb" })
	configuration: Record<string, unknown>;

	@Column({ type: "enum", enum: PriceStatus, default: PriceStatus.ACTIVE })
	status: PriceStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
