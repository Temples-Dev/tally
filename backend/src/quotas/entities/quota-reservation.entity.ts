import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { QuotaReservationStatus, QuotaWindowType } from "../enums";

@Entity("quota_reservations")
@Unique(["tenantId", "operationId"])
@Index(["tenantId", "metricId", "status", "expiresAt"])
@Index(["counterId"])
export class QuotaReservation {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	subscriptionId: string;

	@Column()
	metricId: string;

	@Column()
	counterId: string;

	@Column()
	operationId: string;

	@Column({ default: "tenant" })
	scopeKey: string;

	@Column({ type: "enum", enum: QuotaWindowType })
	windowType: QuotaWindowType;

	@Column({ type: "numeric", precision: 24, scale: 8 })
	reservedQuantity: string;

	@Column({ type: "numeric", precision: 24, scale: 8, default: 0 })
	committedQuantity: string;

	@Column({
		type: "enum",
		enum: QuotaReservationStatus,
		default: QuotaReservationStatus.RESERVED,
	})
	status: QuotaReservationStatus;

	@Column({ default: false })
	exceeded: boolean;

	@Column({ default: false })
	overrun: boolean;

	@Column({ type: "timestamptz" })
	expiresAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	committedAt: Date | null;

	@Column({ type: "timestamptz", nullable: true })
	releasedAt: Date | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
