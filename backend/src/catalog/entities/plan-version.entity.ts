import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { PlanVersionStatus } from "../enums";
import { PlanEntitlement } from "./plan-entitlement.entity";
import { Plan } from "./plan.entity";

@Entity("plan_versions")
@Unique(["tenantId", "planId", "versionNumber"])
@Unique(["tenantId", "id"])
export class PlanVersion {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	planId: string;

	@ManyToOne(
		() => Plan,
		(plan) => plan.versions,
		{ onDelete: "CASCADE" },
	)
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "plan_id", referencedColumnName: "id" },
	])
	plan: Plan;

	@Column()
	versionNumber: number;

	@Column({ type: "timestamptz" })
	effectiveFrom: Date;

	@Column({ type: "timestamptz", nullable: true })
	effectiveUntil: Date | null;

	@Column({ type: "jsonb", default: {} })
	configuration: Record<string, unknown>;

	@Column({
		type: "enum",
		enum: PlanVersionStatus,
		default: PlanVersionStatus.DRAFT,
	})
	status: PlanVersionStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	publishedAt: Date | null;

	@OneToMany(
		() => PlanEntitlement,
		(entitlement) => entitlement.planVersion,
	)
	entitlements: PlanEntitlement[];
}
