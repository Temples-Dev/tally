import {
	Column,
	CreateDateColumn,
	Entity,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

import { TenantStatus } from "../enums";
import { TenantMember } from "./tenant-member.entity";

@Entity("tenants")
export class Tenant {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	name: string;

	@Column({ unique: true })
	slug: string;

	@Column({ type: "enum", enum: TenantStatus, default: TenantStatus.ACTIVE })
	status: TenantStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;

	@OneToMany(
		() => TenantMember,
		(member) => member.tenant,
	)
	members: TenantMember[];
}
