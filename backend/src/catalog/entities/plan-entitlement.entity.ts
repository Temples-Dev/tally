import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import { EntitlementDefinition } from "./entitlement-definition.entity";
import { PlanVersion } from "./plan-version.entity";

@Entity("plan_entitlements")
@Unique(["tenantId", "planVersionId", "entitlementDefinitionId"])
export class PlanEntitlement {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	planVersionId: string;

	@ManyToOne(
		() => PlanVersion,
		(version) => version.entitlements,
		{ onDelete: "CASCADE" },
	)
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "plan_version_id", referencedColumnName: "id" },
	])
	planVersion: PlanVersion;

	@Column()
	entitlementDefinitionId: string;

	@ManyToOne(() => EntitlementDefinition, { onDelete: "RESTRICT" })
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "entitlement_definition_id", referencedColumnName: "id" },
	])
	definition: EntitlementDefinition;

	@Column({ type: "jsonb" })
	value: unknown;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
