import {
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "../identity/audit.service";
import { ActorType } from "../identity/enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { CredentialCipher } from "./credential-cipher.service";
import { PaymentProviderAccount } from "./entities/payment-provider-account.entity";
import { PaymentProviderAccountStatus, PaymentProviderCode } from "./enums";
import type { ConfigurePaymentProviderDto } from "./payments.dto";

export interface PaymentProviderAccountBody {
	id: string;
	provider: PaymentProviderCode;
	status: PaymentProviderAccountStatus;
	externalAccountReference: string | null;
	publicKey: string | null;
	defaultCallbackUrl: string | null;
	secretKeyLast4: string;
	createdAt: string;
	updatedAt: string;
}

@Injectable()
export class PaymentProviderAccountsService {
	constructor(
		@InjectRepository(PaymentProviderAccount)
		private readonly accounts: Repository<PaymentProviderAccount>,
		private readonly dataSource: DataSource,
		private readonly cipher: CredentialCipher,
		private readonly audit: AuditService,
	) {}

	async configure(
		tenantId: string,
		identityId: string,
		dto: ConfigurePaymentProviderDto,
	): Promise<PaymentProviderAccountBody> {
		const encrypted = this.cipher.encrypt(dto.secretKey);
		const account = await this.dataSource.transaction(async (manager) => {
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
				`payment-provider:${tenantId}:${PaymentProviderCode.PAYSTACK}`,
			]);
			const repository = manager.getRepository(PaymentProviderAccount);
			const existing = await repository.findOneBy({
				tenantId,
				providerCode: PaymentProviderCode.PAYSTACK,
			});
			const account =
				existing ??
				repository.create({
					tenantId,
					providerCode: PaymentProviderCode.PAYSTACK,
					externalAccountReference: null,
					status: PaymentProviderAccountStatus.ACTIVE,
				});
			account.encryptedSecretKey = encrypted.ciphertext;
			account.secretKeyIv = encrypted.iv;
			account.secretKeyTag = encrypted.tag;
			account.secretKeyLast4 = dto.secretKey.slice(-4);
			account.publicKey = dto.publicKey ?? null;
			account.defaultCallbackUrl = dto.defaultCallbackUrl ?? null;
			account.status = PaymentProviderAccountStatus.ACTIVE;
			const saved = await repository.save(account);
			await this.audit.record(
				{
					tenantId,
					actorType: ActorType.HUMAN,
					actorId: identityId,
					action:
						existing === null
							? "payment_provider.connected"
							: "payment_provider.updated",
					resourceType: "payment_provider_account",
					resourceId: saved.id,
					metadata: {
						provider: saved.providerCode,
						secretKeyLast4: saved.secretKeyLast4,
					},
				},
				manager,
			);
			return saved;
		});
		return this.toBody(account);
	}

	async list(tenantId: string): Promise<PaymentProviderAccountBody[]> {
		const accounts = await this.accounts.find({
			where: { tenantId },
			order: { createdAt: "ASC" },
		});
		return accounts.map((account) => this.toBody(account));
	}

	async get(
		tenantId: string,
		accountId: string,
	): Promise<PaymentProviderAccountBody> {
		const account = await this.accounts.findOneBy({
			tenantId,
			id: accountId,
		});
		if (account === null) {
			throw new NotFoundException("Payment provider account not found.");
		}
		return this.toBody(account);
	}

	async findEntityById(
		tenantId: string,
		accountId: string,
	): Promise<PaymentProviderAccount | null> {
		return this.accounts.findOneBy({ tenantId, id: accountId });
	}

	async requireActivePaystack(
		tenantId: string,
	): Promise<PaymentProviderAccount> {
		const account = await this.accounts.findOneBy({
			tenantId,
			providerCode: PaymentProviderCode.PAYSTACK,
			status: PaymentProviderAccountStatus.ACTIVE,
		});
		if (account === null) {
			throw new UnprocessableEntityException(
				"Connect an active Paystack account before collecting payments.",
			);
		}
		return account;
	}

	secretKey(account: PaymentProviderAccount): string {
		return this.cipher.decrypt({
			ciphertext: account.encryptedSecretKey,
			iv: account.secretKeyIv,
			tag: account.secretKeyTag,
		});
	}

	toBody(account: PaymentProviderAccount): PaymentProviderAccountBody {
		return {
			id: account.id,
			provider: account.providerCode,
			status: account.status,
			externalAccountReference: account.externalAccountReference,
			publicKey: account.publicKey,
			defaultCallbackUrl: account.defaultCallbackUrl,
			secretKeyLast4: account.secretKeyLast4,
			createdAt: account.createdAt.toISOString(),
			updatedAt: account.updatedAt.toISOString(),
		};
	}
}
