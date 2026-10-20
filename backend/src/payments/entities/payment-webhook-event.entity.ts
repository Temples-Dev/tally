import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
} from "typeorm";

import {
	PaymentWebhookProcessingStatus,
	PaymentWebhookVerificationStatus,
} from "../enums";

@Entity("payment_webhook_events")
@Unique(["tenantId", "providerAccountId", "providerEventId"])
@Index(["tenantId", "processingStatus", "receivedAt"])
export class PaymentWebhookEvent {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column({ type: "uuid" })
	providerAccountId: string;

	@Column({ type: "text" })
	providerEventId: string;

	@Column({ type: "text" })
	eventType: string;

	@Column({
		type: "enum",
		enum: PaymentWebhookVerificationStatus,
		default: PaymentWebhookVerificationStatus.VERIFIED,
	})
	verificationStatus: PaymentWebhookVerificationStatus;

	@Column({
		type: "enum",
		enum: PaymentWebhookProcessingStatus,
		default: PaymentWebhookProcessingStatus.PENDING,
	})
	processingStatus: PaymentWebhookProcessingStatus;

	@Column({ type: "jsonb" })
	payload: Record<string, unknown>;

	@Column({ type: "text" })
	payloadHash: string;

	@Column({ type: "text", nullable: true })
	errorCode: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	receivedAt: Date;

	@Column({ type: "timestamptz", nullable: true })
	processedAt: Date | null;
}
