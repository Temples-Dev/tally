import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { AggregationMethod } from "../../catalog/enums";

@Entity("usage_aggregates")
@Unique(["tenantId", "periodStart", "periodEnd", "scopeKey"])
@Index(["tenantId", "metricId", "periodStart", "periodEnd"])
@Index(["tenantId", "customerAccountId", "periodStart"])
export class UsageAggregate {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column()
	customerAccountId: string;

	@Column({ type: "uuid", nullable: true })
	subscriptionId: string | null;

	@Column()
	metricId: string;

	@Column({ type: "timestamptz" })
	periodStart: Date;

	@Column({ type: "timestamptz" })
	periodEnd: Date;

	@Column({ type: "jsonb", default: {} })
	dimensions: Record<string, unknown>;

	@Column()
	scopeKey: string;

	@Column({ type: "enum", enum: AggregationMethod })
	aggregationMethod: AggregationMethod;

	@Column({ type: "numeric", precision: 24, scale: 8 })
	value: string;

	@Column({ type: "bigint" })
	eventCount: string;

	@Column({ type: "timestamptz", nullable: true })
	latestOccurredAt: Date | null;

	@Column({ type: "uuid", nullable: true })
	latestEventId: string | null;

	@Column({ type: "int", default: 1 })
	revision: number;

	@Column({ type: "timestamptz" })
	calculatedAt: Date;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
