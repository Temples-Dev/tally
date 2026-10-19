import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { MeterStatus } from "../enums";

@Entity("usage_metrics")
@Unique(["tenantId", "code"])
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

	@Column({ type: "enum", enum: MeterStatus, default: MeterStatus.ACTIVE })
	status: MeterStatus;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
