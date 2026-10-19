import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { AggregationMethod, MeterStatus } from "../enums";

@Entity("usage_metrics")
@Unique(["tenantId", "code"])
@Unique(["tenantId", "id"])
export class UsageMetric {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	code: string;

	@Column()
	name: string;

	@Column()
	unit: string;

	@Column({
		type: "enum",
		enum: AggregationMethod,
		default: AggregationMethod.SUM,
	})
	aggregationMethod: AggregationMethod;

	@Column({ default: false })
	allowsNegative: boolean;

	@Column({ type: "int", nullable: true })
	maxEventAgeSeconds: number | null;

	@Column({ type: "int", default: 300 })
	maxFutureSkewSeconds: number;

	@Column({ type: "jsonb", nullable: true })
	allowedDimensions: string[] | null;

	@Column({ type: "enum", enum: MeterStatus, default: MeterStatus.ACTIVE })
	status: MeterStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
