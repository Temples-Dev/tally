import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";

import { EntitlementDefinition } from "../../catalog/entities/entitlement-definition.entity";
import { Subscription } from "./subscription.entity";

@Entity("entitlement_overrides")
@Index(["tenantId", "subscriptionId", "effectiveFrom", "effectiveUntil"])
export class EntitlementOverride {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	subscriptionId: string;

	@ManyToOne(() => Subscription, { onDelete: "CASCADE" })
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "subscription_id", referencedColumnName: "id" },
	])
	subscription: Subscription;

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

	@Column({ type: "text" })
	reason: string;

	@Column({ type: "timestamptz" })
	effectiveFrom: Date;

	@Column({ type: "timestamptz", nullable: true })
	effectiveUntil: Date | null;

	@Column()
	createdBy: string;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;
}
