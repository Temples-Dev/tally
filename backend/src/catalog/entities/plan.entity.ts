import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { PlanStatus } from "../enums";
import { PlanVersion } from "./plan-version.entity";
import { Product } from "./product.entity";

@Entity("plans")
@Unique(["tenantId", "productId", "code"])
@Unique(["tenantId", "id"])
export class Plan {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	productId: string;

	@ManyToOne(() => Product, { onDelete: "RESTRICT" })
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "product_id", referencedColumnName: "id" },
	])
	product: Product;

	@Column()
	code: string;

	@Column()
	name: string;

	@Column({ type: "text", nullable: true })
	description: string | null;

	@Column({ type: "enum", enum: PlanStatus, default: PlanStatus.DRAFT })
	status: PlanStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;

	@OneToMany(
		() => PlanVersion,
		(version) => version.plan,
	)
	versions: PlanVersion[];
}
