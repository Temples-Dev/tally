import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

import {
	QuotaEnforcementMode,
	QuotaOveragePolicy,
	QuotaWindowType,
} from "../enums";

@Entity("quota_policies")
@Index(["tenantId", "metricId"], { unique: true })
@Index(["tenantId", "subscriptionId", "metricId"])
export class QuotaPolicy {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	subscriptionId: string;

	@Column()
	metricId: string;

	@Column({ type: "numeric", precision: 24, scale: 8, nullable: true })
	limitValue: string | null;

	@Column({ default: false })
	unmetered: boolean;

	@Column({ type: "enum", enum: QuotaWindowType })
	windowType: QuotaWindowType;

	@Column({ type: "int", nullable: true })
	windowSize: number | null;

	@Column({ type: "enum", enum: QuotaEnforcementMode })
	enforcementMode: QuotaEnforcementMode;

	@Column({ type: "enum", enum: QuotaOveragePolicy })
	overagePolicy: QuotaOveragePolicy;

	@Column({ type: "timestamptz" })
	effectiveFrom: Date;

	@Column({ type: "timestamptz", nullable: true })
	effectiveUntil: Date | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
