import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { BackgroundJobStatus } from "../enums";

@Entity("background_jobs")
@Unique(["jobType", "idempotencyKey"])
@Index(["status", "availableAt"])
@Index(["lockedAt"])
@Index(["tenantId", "createdAt"])
export class BackgroundJob {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column({ type: "uuid", nullable: true })
	tenantId: string | null;

	@Column()
	jobType: string;

	@Column()
	idempotencyKey: string;

	@Column({ type: "jsonb", default: {} })
	payload: Record<string, unknown>;

	@Column({
		type: "enum",
		enum: BackgroundJobStatus,
		default: BackgroundJobStatus.PENDING,
	})
	status: BackgroundJobStatus;

	@Column({ default: 0 })
	attemptCount: number;

	@Column({ default: 5 })
	maxAttempts: number;

	@Column({ type: "timestamptz" })
	availableAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	lockedAt: Date | null;

	@Column({ type: "text", nullable: true })
	lockedBy: string | null;

	@Column({ type: "text", nullable: true })
	lastErrorCode: string | null;

	@Column({ type: "text", nullable: true })
	lastError: string | null;

	@Column({ type: "timestamptz", nullable: true })
	completedAt: Date | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
