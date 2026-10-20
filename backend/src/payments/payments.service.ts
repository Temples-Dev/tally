import { createHash, randomUUID } from "node:crypto";

import {
	BadGatewayException,
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager, Repository } from "typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

import { formatDecimal, parseDecimal } from "../billing/billing-money";
import { InvoiceStatus } from "../billing/enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "../identity/audit.service";
import { ActorType } from "../identity/enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BackgroundJobsService } from "../jobs/background-jobs.service";
import { PaymentAttempt } from "./entities/payment-attempt.entity";
import { PaymentTransaction } from "./entities/payment-transaction.entity";
import {
	PaymentAttemptStatus,
	PaymentProviderCode,
	PaymentTransactionStatus,
	PaymentTransactionType,
	PaymentWebhookProcessingStatus,
	PaymentWebhookVerificationStatus,
} from "./enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { PaymentProviderAccountsService } from "./payment-provider-accounts.service";
import type { InitiatePaymentDto } from "./payments.dto";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { PaymentProviderError, PaystackAdapter } from "./paystack.adapter";

export const PAYMENTS_WEBHOOK_JOB = "payments.webhook.process";

const PAYABLE_INVOICE_STATUSES = new Set<string>([
	InvoiceStatus.OPEN,
	InvoiceStatus.PARTIALLY_PAID,
]);

export interface PaymentAttemptBody {
	id: string;
	invoiceId: string;
	provider: PaymentProviderCode;
	amount: string;
	currency: string;
	status: PaymentAttemptStatus;
	providerReference: string;
	checkoutUrl: string | null;
	failureCode: string | null;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
}

interface InvoicePaymentRow {
	id: string;
	status: string;
	currency: string;
	amount_paid: string;
	amount_due: string;
	billing_profile_snapshot: Record<string, unknown> | null;
}

interface AttemptRow {
	id: string;
	tenant_id: string;
	invoice_id: string;
	provider_account_id: string;
	amount: string;
	currency: string;
	status: string;
	provider_reference: string;
}

interface InvoiceBalanceRow {
	id: string;
	status: string;
	currency: string;
	amount_paid: string;
	amount_due: string;
}

interface WebhookEventRow {
	id: string;
	tenant_id: string;
	provider_account_id: string;
	processing_status: string;
	event_type: string;
	payload: Record<string, unknown>;
}

interface WebhookEventPayload {
	providerEventId: string;
	eventType: string;
	reference: string;
	providerTransactionId: string;
	status: string | null;
	amount: string;
	providerAmount: string;
	currency: string;
	paidAt: string | null;
	gatewayResponse: string | null;
	channel: string | null;
	paymentAttemptId: string;
	invoiceId: string;
}

export interface InitiatePaymentResult {
	attempt: PaymentAttemptBody;
	providerError: PaymentProviderError | null;
}

@Injectable()
export class PaymentsService {
	constructor(
		@InjectRepository(PaymentAttempt)
		private readonly attempts: Repository<PaymentAttempt>,
		private readonly dataSource: DataSource,
		private readonly accounts: PaymentProviderAccountsService,
		private readonly paystack: PaystackAdapter,
		private readonly jobs: BackgroundJobsService,
		private readonly audit: AuditService,
	) {}

	async initiate(
		tenantId: string,
		identityId: string,
		invoiceId: string,
		idempotencyKey: string,
		dto: InitiatePaymentDto,
	): Promise<InitiatePaymentResult> {
		const account = await this.accounts.requireActivePaystack(tenantId);
		const secretKey = this.accounts.secretKey(account);
		const key =
			idempotencyKey.trim().length > 0 ? idempotencyKey.trim() : randomUUID();

		const result = await this.dataSource.transaction(async (manager) => {
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
				`payment-init:${tenantId}:${account.id}:${key}`,
			]);
			const repository = manager.getRepository(PaymentAttempt);
			const existing = await repository.findOneBy({
				tenantId,
				providerAccountId: account.id,
				idempotencyKey: key,
			});
			if (existing !== null) {
				if (existing.invoiceId !== invoiceId) {
					throw new ConflictException(
						"The idempotency key was already used for another invoice.",
					);
				}
				return { attempt: existing, providerError: null };
			}

			const invoice = await this.lockInvoiceForPayment(
				manager,
				tenantId,
				invoiceId,
			);
			if (!PAYABLE_INVOICE_STATUSES.has(invoice.status)) {
				throw new UnprocessableEntityException(
					"This invoice cannot accept payments.",
				);
			}
			const amountDue = parseDecimal(invoice.amount_due);
			if (amountDue === null || amountDue <= 0n) {
				throw new UnprocessableEntityException(
					"This invoice has no outstanding balance.",
				);
			}
			if (!this.paystack.supportsCurrency(invoice.currency)) {
				throw new UnprocessableEntityException(
					`Payments in ${invoice.currency} are not supported.`,
				);
			}
			const email = this.invoiceEmail(invoice);
			if (email === null) {
				throw new UnprocessableEntityException(
					"The invoice has no billing email.",
				);
			}

			const attempt = repository.create({
				tenantId,
				invoiceId,
				providerAccountId: account.id,
				idempotencyKey: key,
				amount: formatDecimal(amountDue),
				currency: invoice.currency,
				status: PaymentAttemptStatus.PENDING,
				providerReference: `pay_${randomUUID()}`,
				checkoutUrl: null,
				failureCode: null,
				completedAt: null,
			});
			const saved = await repository.save(attempt);
			try {
				const initialized = await this.paystack.initialize({
					secretKey,
					email,
					amount: amountDue,
					currency: invoice.currency,
					reference: saved.providerReference,
					callbackUrl: dto.returnUrl ?? account.defaultCallbackUrl ?? undefined,
					metadata: {
						tenantId,
						invoiceId,
						paymentAttemptId: saved.id,
					},
				});
				saved.checkoutUrl = initialized.authorizationUrl;
				saved.status = PaymentAttemptStatus.REQUIRES_ACTION;
				const updated = await repository.save(saved);
				await this.audit.record(
					{
						tenantId,
						actorType: ActorType.HUMAN,
						actorId: identityId,
						action: "payment.initiated",
						resourceType: "payment_attempt",
						resourceId: updated.id,
						metadata: {
							invoiceId,
							amount: updated.amount,
							currency: updated.currency,
						},
					},
					manager,
				);
				return { attempt: updated, providerError: null };
			} catch (error) {
				const providerError =
					error instanceof PaymentProviderError
						? error
						: new PaymentProviderError(
								"The payment provider could not start the checkout.",
								"PROVIDER_ERROR",
							);
				saved.status = PaymentAttemptStatus.FAILED;
				saved.failureCode = providerError.code;
				saved.completedAt = new Date();
				const updated = await repository.save(saved);
				await this.audit.record(
					{
						tenantId,
						actorType: ActorType.HUMAN,
						actorId: identityId,
						action: "payment.initiation_failed",
						resourceType: "payment_attempt",
						resourceId: updated.id,
						metadata: {
							invoiceId,
							failureCode: providerError.code,
						},
					},
					manager,
				);
				return { attempt: updated, providerError };
			}
		});

		return {
			attempt: this.toAttemptBody(result.attempt, account.providerCode),
			providerError: result.providerError,
		};
	}

	async get(tenantId: string, paymentId: string): Promise<PaymentAttemptBody> {
		const attempt = await this.attempts.findOneBy({
			tenantId,
			id: paymentId,
		});
		if (attempt === null) {
			throw new NotFoundException("Payment not found.");
		}
		return this.toAttemptBody(attempt, PaymentProviderCode.PAYSTACK);
	}

	async handlePaystackWebhook(
		rawBody: Buffer,
		signature: string | undefined,
	): Promise<{ received: true; duplicate?: true }> {
		if (typeof signature !== "string" || signature.length === 0) {
			throw new UnauthorizedException("Missing webhook signature.");
		}
		const parsed = this.parseWebhook(rawBody);
		const eventType = parsed.event;
		const data = parsed.data;
		const reference = data.reference;
		if (typeof eventType !== "string" || typeof reference !== "string") {
			throw new BadRequestException("Invalid Paystack webhook payload.");
		}
		const attempt = await this.attempts.findOneBy({
			providerReference: reference,
		});
		if (attempt === null) {
			return { received: true };
		}
		const account = await this.accounts.findEntityById(
			attempt.tenantId,
			attempt.providerAccountId,
		);
		if (account === null) {
			throw new UnauthorizedException("Unknown payment provider account.");
		}
		const secretKey = this.accounts.secretKey(account);
		if (!this.paystack.verifyWebhook(rawBody, signature, secretKey)) {
			throw new UnauthorizedException("Invalid webhook signature.");
		}
		const event = this.normalizeWebhookEvent(eventType, data, attempt);
		const payloadHash = createHash("sha256").update(rawBody).digest("hex");

		return this.dataSource.transaction(async (manager) => {
			const inserted = (await manager.query(
				`
				INSERT INTO payment_webhook_events (
					tenant_id, provider_account_id, provider_event_id, event_type,
					verification_status, processing_status, payload, payload_hash
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
				ON CONFLICT (tenant_id, provider_account_id, provider_event_id)
					DO NOTHING
				RETURNING id
				`,
				[
					attempt.tenantId,
					attempt.providerAccountId,
					event.providerEventId,
					event.eventType,
					PaymentWebhookVerificationStatus.VERIFIED,
					PaymentWebhookProcessingStatus.PENDING,
					JSON.stringify(event),
					payloadHash,
				],
			)) as Array<{ id: string }>;
			const eventId = inserted[0]?.id;
			if (eventId === undefined) {
				return { received: true, duplicate: true } as const;
			}
			await this.jobs.enqueue(
				{
					tenantId: attempt.tenantId,
					jobType: PAYMENTS_WEBHOOK_JOB,
					idempotencyKey: `payment-webhook:${eventId}`,
					payload: { eventId },
				},
				manager,
			);
			return { received: true } as const;
		});
	}

	async processWebhookEvent(eventId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const event = await this.lockWebhookEvent(manager, eventId);
			if (event === null) {
				return;
			}
			if (
				event.processing_status === PaymentWebhookProcessingStatus.PROCESSED ||
				event.processing_status === PaymentWebhookProcessingStatus.IGNORED
			) {
				return;
			}
			const payload = event.payload as unknown as WebhookEventPayload;
			if (!this.isWebhookPayload(payload)) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"INVALID_PAYLOAD",
				);
				return;
			}
			if (
				payload.eventType !== "charge.success" &&
				payload.eventType !== "charge.failed"
			) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.IGNORED,
					null,
				);
				return;
			}
			const attempt = await this.lockAttempt(
				manager,
				event.tenant_id,
				payload.paymentAttemptId,
			);
			if (attempt === null) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"PAYMENT_ATTEMPT_NOT_FOUND",
				);
				return;
			}
			if (payload.eventType === "charge.failed") {
				if (attempt.status === PaymentAttemptStatus.SUCCEEDED) {
					await this.markWebhookEvent(
						manager,
						event.id,
						PaymentWebhookProcessingStatus.IGNORED,
						null,
					);
					return;
				}
				await manager.query(
					`
					UPDATE payment_attempts
					SET status = $3, failure_code = $4, completed_at = now(),
						updated_at = now()
					WHERE tenant_id = $1 AND id = $2
					`,
					[
						event.tenant_id,
						attempt.id,
						PaymentAttemptStatus.FAILED,
						payload.status ?? "charge_failed",
					],
				);
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.PROCESSED,
					null,
				);
				return;
			}

			if (attempt.status === PaymentAttemptStatus.CANCELLED) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"PAYMENT_ATTEMPT_CANCELLED",
				);
				return;
			}
			if (payload.currency !== attempt.currency) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"CURRENCY_MISMATCH",
				);
				return;
			}
			const paidAmount = parseDecimal(payload.amount);
			const attemptAmount = parseDecimal(attempt.amount);
			if (
				paidAmount === null ||
				attemptAmount === null ||
				paidAmount !== attemptAmount
			) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"AMOUNT_MISMATCH",
				);
				return;
			}
			const existingTransaction = await manager
				.getRepository(PaymentTransaction)
				.findOneBy({
					providerAccountId: event.provider_account_id,
					providerTransactionReference: payload.providerTransactionId,
					transactionType: PaymentTransactionType.PAYMENT,
				});
			if (existingTransaction !== null) {
				await manager.query(
					`
					UPDATE payment_attempts
					SET status = $3, completed_at = COALESCE(completed_at, now()),
						updated_at = now()
					WHERE tenant_id = $1 AND id = $2
					`,
					[event.tenant_id, attempt.id, PaymentAttemptStatus.SUCCEEDED],
				);
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.PROCESSED,
					null,
				);
				return;
			}
			const invoice = await this.lockInvoiceBalance(
				manager,
				event.tenant_id,
				attempt.invoice_id,
			);
			if (invoice === null || !PAYABLE_INVOICE_STATUSES.has(invoice.status)) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"INVOICE_NOT_PAYABLE",
				);
				return;
			}
			if (invoice.currency !== attempt.currency) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"CURRENCY_MISMATCH",
				);
				return;
			}
			const amountPaid = parseDecimal(invoice.amount_paid);
			const amountDue = parseDecimal(invoice.amount_due);
			if (amountPaid === null || amountDue === null || paidAmount === null) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"INVALID_INVOICE_BALANCE",
				);
				return;
			}
			if (paidAmount > amountDue) {
				await this.markWebhookEvent(
					manager,
					event.id,
					PaymentWebhookProcessingStatus.FAILED,
					"PAYMENT_EXCEEDS_AMOUNT_DUE",
				);
				return;
			}
			const newAmountPaid = amountPaid + paidAmount;
			const newAmountDue = amountDue - paidAmount;
			const newStatus =
				newAmountDue === 0n ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

			await manager.query(
				`
				INSERT INTO payment_transactions (
					tenant_id, invoice_id, provider_account_id, payment_attempt_id,
					provider_transaction_reference, transaction_type, amount, currency,
					status, occurred_at, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
				`,
				[
					event.tenant_id,
					attempt.invoice_id,
					event.provider_account_id,
					attempt.id,
					payload.providerTransactionId,
					PaymentTransactionType.PAYMENT,
					payload.amount,
					payload.currency,
					PaymentTransactionStatus.SUCCEEDED,
					payload.paidAt === null ? new Date() : new Date(payload.paidAt),
					JSON.stringify({
						reference: payload.reference,
						gatewayResponse: payload.gatewayResponse,
						channel: payload.channel,
					}),
				],
			);
			await manager.query(
				`
				UPDATE invoices
				SET amount_paid = $3, amount_due = $4, status = $5, updated_at = now()
				WHERE tenant_id = $1 AND id = $2
				`,
				[
					event.tenant_id,
					invoice.id,
					formatDecimal(newAmountPaid),
					formatDecimal(newAmountDue),
					newStatus,
				],
			);
			await manager.query(
				`
				UPDATE payment_attempts
				SET status = $3, failure_code = NULL, completed_at = now(),
					updated_at = now()
				WHERE tenant_id = $1 AND id = $2
				`,
				[event.tenant_id, attempt.id, PaymentAttemptStatus.SUCCEEDED],
			);
			await this.audit.record(
				{
					tenantId: event.tenant_id,
					actorType: ActorType.SYSTEM,
					actorId: null,
					action: "payment.succeeded",
					resourceType: "payment_attempt",
					resourceId: attempt.id,
					metadata: {
						invoiceId: attempt.invoice_id,
						amount: payload.amount,
						currency: payload.currency,
						providerTransactionId: payload.providerTransactionId,
					},
				},
				manager,
			);
			await this.markWebhookEvent(
				manager,
				event.id,
				PaymentWebhookProcessingStatus.PROCESSED,
				null,
			);
		});
	}

	private async lockInvoiceForPayment(
		manager: EntityManager,
		tenantId: string,
		invoiceId: string,
	): Promise<InvoicePaymentRow> {
		const rows = (await manager.query(
			`
			SELECT id, status, currency, amount_paid, amount_due,
				billing_profile_snapshot
			FROM invoices
			WHERE tenant_id = $1 AND id = $2
			FOR UPDATE
			`,
			[tenantId, invoiceId],
		)) as InvoicePaymentRow[];
		const invoice = rows[0];
		if (invoice === undefined) {
			throw new NotFoundException("Invoice not found.");
		}
		return invoice;
	}

	private async lockInvoiceBalance(
		manager: EntityManager,
		tenantId: string,
		invoiceId: string,
	): Promise<InvoiceBalanceRow | null> {
		const rows = (await manager.query(
			`
			SELECT id, status, currency, amount_paid, amount_due
			FROM invoices
			WHERE tenant_id = $1 AND id = $2
			FOR UPDATE
			`,
			[tenantId, invoiceId],
		)) as InvoiceBalanceRow[];
		return rows[0] ?? null;
	}

	private async lockAttempt(
		manager: EntityManager,
		tenantId: string,
		attemptId: string,
	): Promise<AttemptRow | null> {
		const rows = (await manager.query(
			`
			SELECT id, tenant_id, invoice_id, provider_account_id, amount,
				currency, status, provider_reference
			FROM payment_attempts
			WHERE tenant_id = $1 AND id = $2
			FOR UPDATE
			`,
			[tenantId, attemptId],
		)) as AttemptRow[];
		return rows[0] ?? null;
	}

	private async lockWebhookEvent(
		manager: EntityManager,
		eventId: string,
	): Promise<WebhookEventRow | null> {
		const rows = (await manager.query(
			`
			SELECT id, tenant_id, provider_account_id, processing_status,
				event_type, payload
			FROM payment_webhook_events
			WHERE id = $1
			FOR UPDATE
			`,
			[eventId],
		)) as WebhookEventRow[];
		return rows[0] ?? null;
	}

	private async markWebhookEvent(
		manager: EntityManager,
		eventId: string,
		status: PaymentWebhookProcessingStatus,
		errorCode: string | null,
	): Promise<void> {
		await manager.query(
			`
			UPDATE payment_webhook_events
			SET processing_status = $2, error_code = $3,
				processed_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END
			WHERE id = $1
			`,
			[eventId, status, errorCode],
		);
	}

	private parseWebhook(rawBody: Buffer): {
		event?: unknown;
		data: Record<string, unknown>;
	} {
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawBody.toString("utf8"));
		} catch {
			throw new BadRequestException("Invalid Paystack webhook payload.");
		}
		if (parsed === null || typeof parsed !== "object") {
			throw new BadRequestException("Invalid Paystack webhook payload.");
		}
		const record = parsed as Record<string, unknown>;
		const data = record.data;
		if (data === null || typeof data !== "object" || Array.isArray(data)) {
			throw new BadRequestException("Invalid Paystack webhook payload.");
		}
		return { event: record.event, data: data as Record<string, unknown> };
	}

	private normalizeWebhookEvent(
		eventType: string,
		data: Record<string, unknown>,
		attempt: PaymentAttempt,
	): WebhookEventPayload {
		const reference = data.reference;
		const currency = data.currency;
		const amount = data.amount;
		if (
			typeof reference !== "string" ||
			typeof currency !== "string" ||
			(typeof amount !== "number" && typeof amount !== "string")
		) {
			throw new BadRequestException("Invalid Paystack webhook payload.");
		}
		const transactionId = data.id;
		const providerTransactionId =
			typeof transactionId === "number" || typeof transactionId === "string"
				? String(transactionId)
				: reference;
		const internalAmount = this.paystack.fromProviderAmount(
			amount,
			attempt.currency,
		);
		return {
			providerEventId: `${eventType}:${providerTransactionId}`,
			eventType,
			reference,
			providerTransactionId,
			status: typeof data.status === "string" ? data.status : null,
			amount: formatDecimal(internalAmount),
			providerAmount: String(amount),
			currency: currency.toUpperCase(),
			paidAt: typeof data.paid_at === "string" ? data.paid_at : null,
			gatewayResponse:
				typeof data.gateway_response === "string"
					? data.gateway_response
					: null,
			channel: typeof data.channel === "string" ? data.channel : null,
			paymentAttemptId: attempt.id,
			invoiceId: attempt.invoiceId,
		};
	}

	private isWebhookPayload(
		payload: WebhookEventPayload,
	): payload is WebhookEventPayload {
		return (
			typeof payload === "object" &&
			payload !== null &&
			typeof payload.eventType === "string" &&
			typeof payload.amount === "string" &&
			typeof payload.currency === "string" &&
			typeof payload.paymentAttemptId === "string" &&
			typeof payload.providerTransactionId === "string"
		);
	}

	private invoiceEmail(invoice: InvoicePaymentRow): string | null {
		const email = invoice.billing_profile_snapshot?.email;
		return typeof email === "string" && email.trim().length > 0 ? email : null;
	}

	private toAttemptBody(
		attempt: PaymentAttempt,
		provider: PaymentProviderCode,
	): PaymentAttemptBody {
		return {
			id: attempt.id,
			invoiceId: attempt.invoiceId,
			provider,
			amount: this.normalizeMoney(attempt.amount),
			currency: attempt.currency,
			status: attempt.status,
			providerReference: attempt.providerReference,
			checkoutUrl: attempt.checkoutUrl,
			failureCode: attempt.failureCode,
			createdAt: attempt.createdAt.toISOString(),
			updatedAt: attempt.updatedAt.toISOString(),
			completedAt: attempt.completedAt?.toISOString() ?? null,
		};
	}

	private normalizeMoney(value: string): string {
		const parsed = parseDecimal(value);
		return parsed === null ? value : formatDecimal(parsed);
	}
}
