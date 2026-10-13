import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { MemberRole, MemberStatus } from "../enums";
import { Tenant } from "./tenant.entity";

@Entity("tenant_members")
@Unique(["tenantId", "externalIdentityId"])
@Index(["tenantId", "role", "status"])
export class TenantMember {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@ManyToOne(
		() => Tenant,
		(tenant) => tenant.members,
		{ onDelete: "CASCADE" },
	)
	@JoinColumn({ name: "tenant_id" })
	tenant: Tenant;

	@Column()
	externalIdentityId: string;

	@Column({ type: "enum", enum: MemberRole })
	role: MemberRole;

	@Column({ type: "enum", enum: MemberStatus, default: MemberStatus.ACTIVE })
	status: MemberStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
