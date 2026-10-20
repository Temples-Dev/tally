import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from "typeorm";

import { PaymentProviderAccountStatus, PaymentProviderCode } from "../enums";

@Entity("payment_provider_accounts")
@Unique(["tenantId", "providerCode"])
@Index(["tenantId", "status"])
export class PaymentProviderAccount {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@Column()
	tenantId: string;

	@Column({ type: "enum", enum: PaymentProviderCode })
	providerCode: PaymentProviderCode;

	@Column({ type: "text", nullable: true })
	externalAccountReference: string | null;

	@Column({
		type: "enum",
		enum: PaymentProviderAccountStatus,
		default: PaymentProviderAccountStatus.ACTIVE,
	})
	status: PaymentProviderAccountStatus;

	@Column({ type: "text" })
	encryptedSecretKey: string;

	@Column({ type: "text" })
	secretKeyIv: string;

	@Column({ type: "text" })
	secretKeyTag: string;

	@Column({ type: "char", length: 4 })
	secretKeyLast4: string;

	@Column({ type: "text", nullable: true })
	publicKey: string | null;

	@Column({ type: "text", nullable: true })
	defaultCallbackUrl: string | null;

	@CreateDateColumn({ type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ type: "timestamptz" })
	updatedAt: Date;
}
