import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

@Entity("subscription_items")
@Unique(["tenantId", "subscriptionId", "priceId"])
export class SubscriptionItem {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	subscriptionId: string;

	@Column()
	priceId: string;

	@Column({ type: "numeric", precision: 24, scale: 8, default: 1 })
	quantity: string;

	@Column({ type: "text", nullable: true })
	description: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
