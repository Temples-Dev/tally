import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { DefinitionStatus, EntitlementValueType } from "../enums";

@Entity("entitlement_definitions")
@Unique(["tenantId", "code"])
@Unique(["tenantId", "id"])
export class EntitlementDefinition {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	code: string;

	@Column()
	name: string;

	@Column({ type: "text", nullable: true })
	description: string | null;

	@Column({ type: "enum", enum: EntitlementValueType })
	valueType: EntitlementValueType;

	@Column({ type: "jsonb", nullable: true })
	defaultValue: unknown;

	@Column({ type: "jsonb", nullable: true })
	validationSchema: Record<string, unknown> | null;

	@Column({
		type: "enum",
		enum: DefinitionStatus,
		default: DefinitionStatus.ACTIVE,
	})
	status: DefinitionStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
