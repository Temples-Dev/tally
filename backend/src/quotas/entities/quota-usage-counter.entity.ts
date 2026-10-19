import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

@Entity("quota_usage_counters")
@Unique(["tenantId", "metricId", "periodStart", "periodEnd"])
@Index(["tenantId", "metricId", "periodStart"])
export class QuotaUsageCounter {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	subscriptionId: string;

	@Column()
	metricId: string;

	@Column({ type: "timestamptz" })
	periodStart: Date;

	@Column({ type: "timestamptz" })
	periodEnd: Date;

	@Column({ type: "numeric", precision: 24, scale: 8, default: 0 })
	usedValue: string;

	@Column({ type: "numeric", precision: 24, scale: 8, default: 0 })
	reservedValue: string;

	@Column({ type: "int", default: 1 })
	counterVersion: number;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
