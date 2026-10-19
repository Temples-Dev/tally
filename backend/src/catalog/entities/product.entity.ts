import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { ProductStatus } from "../enums";

@Entity("products")
@Unique(["tenantId", "code"])
@Unique(["tenantId", "id"])
export class Product {
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

	@Column({ type: "enum", enum: ProductStatus, default: ProductStatus.ACTIVE })
	status: ProductStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
