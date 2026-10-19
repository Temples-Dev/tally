import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { CustomerStatus } from "../enums";

@Entity("customer_accounts")
@Unique(["tenantId", "id"])
export class CustomerAccount {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column({ type: "text", nullable: true })
	externalCustomerRef: string | null;

	@Column()
	displayName: string;

	@Column({ type: "text", nullable: true })
	email: string | null;

	@Column({
		type: "enum",
		enum: CustomerStatus,
		default: CustomerStatus.ACTIVE,
	})
	status: CustomerStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
