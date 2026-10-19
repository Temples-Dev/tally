import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { PlanVersion } from "../../catalog/entities/plan-version.entity";
import { Product } from "../../catalog/entities/product.entity";
import { SubscriptionStatus } from "../enums";
import { CustomerAccount } from "./customer-account.entity";
import { SubscriptionChange } from "./subscription-change.entity";

@Entity("subscriptions")
@Unique(["tenantId", "id"])
@Index("uq_subscriptions_active_per_product", ["tenantId", "productId"], {
	unique: true,
	where: "status IN ('active', 'trialing')",
})
@Index(["tenantId", "customerAccountId", "status"])
@Index(["tenantId", "status", "currentPeriodEnd"])
export class Subscription {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	customerAccountId: string;

	@ManyToOne(() => CustomerAccount, { onDelete: "RESTRICT" })
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "customer_account_id", referencedColumnName: "id" },
	])
	customerAccount: CustomerAccount;

	@Column()
	productId: string;

	@ManyToOne(() => Product, { onDelete: "RESTRICT" })
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "product_id", referencedColumnName: "id" },
	])
	product: Product;

	@Column()
	planVersionId: string;

	@ManyToOne(() => PlanVersion, { onDelete: "RESTRICT" })
	@JoinColumn([
		{ name: "tenant_id", referencedColumnName: "tenantId" },
		{ name: "plan_version_id", referencedColumnName: "id" },
	])
	planVersion: PlanVersion;

	@Column({
		type: "enum",
		enum: SubscriptionStatus,
		default: SubscriptionStatus.PENDING,
	})
	status: SubscriptionStatus;

	@Column({ type: "timestamptz", nullable: true })
	startedAt: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	currentPeriodStart: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	currentPeriodEnd: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	trialEndsAt: Date | null;

	@Column({ default: false })
	cancelAtPeriodEnd: boolean;

	@Column({ type: "timestamptz", nullable: true })
	cancelledAt: Date | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;

	@OneToMany(
		() => SubscriptionChange,
		(change) => change.subscription,
	)
	changes: SubscriptionChange[];
}
