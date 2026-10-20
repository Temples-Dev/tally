import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, type Repository } from "typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

import { isUniqueViolation } from "../common/database-errors";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "../identity/audit.service";
import { ActorType } from "../identity/enums";
import { CustomerAccount } from "../subscriptions/entities/customer-account.entity";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import type {
	CreateAdjustmentDto,
	CreateCreditNoteDto,
	ListAdjustmentsQueryDto,
	ListCreditNotesQueryDto,
	VoidInvoiceDto,
} from "./billing-corrections.dto";
import {
	currencyPrecision,
	formatDecimal,
	parseDecimal,
	roundToCurrency,
} from "./billing-money";
import { BillingAdjustment } from "./entities/billing-adjustment.entity";
import { CreditNoteLine } from "./entities/credit-note-line.entity";
import { CreditNote } from "./entities/credit-note.entity";
import {
	AdjustmentStatus,
	type AdjustmentType,
	CreditNoteStatus,
	InvoiceStatus,
} from "./enums";

export interface CreditNoteLineBody {
	id: string;
	lineNumber: number;
	invoiceLineId: string | null;
	description: string;
	amount: string;
}

export interface CreditNoteBody {
	id: string;
	customerAccountId: string;
	invoiceId: string;
	creditNoteNumber: string;
	currency: string;
	amount: string;
	reason: string;
	status: CreditNoteStatus;
	issuedAt: string;
	createdAt: string;
	lines: CreditNoteLineBody[];
}

export interface AdjustmentBody {
	id: string;
	customerAccountId: string;
	subscriptionId: string | null;
	invoiceId: string | null;
	adjustmentType: AdjustmentType;
	amount: string;
	currency: string;
	reason: string;
	status: AdjustmentStatus;
	idempotencyKey: string;
	createdBy: string | null;
	appliedAt: string | null;
	createdAt: string;
}

interface InvoiceRow {
	id: string;
	customerAccountId: string;
	currency: string;
	status: InvoiceStatus;
	total: string;
	amountPaid: string;
	amountCredited: string;
}

interface CreditNoteRow {
	id: string;
	customerAccountId: string;
	invoiceId: string;
	creditNoteNumber: string;
	currency: string;
	amount: string;
	reason: string;
	status: CreditNoteStatus;
	issuedAt: Date;
	createdAt: Date;
}

@Injectable()
export class BillingCorrectionsService {
	constructor(
		@InjectRepository(CreditNote)
		private readonly creditNotes: Repository<CreditNote>,
		@InjectRepository(CreditNoteLine)
		private readonly creditNoteLines: Repository<CreditNoteLine>,
		@InjectRepository(BillingAdjustment)
		private readonly adjustments: Repository<BillingAdjustment>,
		@InjectRepository(CustomerAccount)
		private readonly customers: Repository<CustomerAccount>,
		@InjectRepository(Subscription)
		private readonly subscriptions: Repository<Subscription>,
		private readonly dataSource: DataSource,
		private readonly audit: AuditService,
	) {}

	async createCreditNote(
		tenantId: string,
		identityId: string,
		invoiceId: string,
		dto: CreateCreditNoteDto,
	): Promise<CreditNoteBody> {
		const amount = this.requireAmount(dto.amount, "amount");
		const note = await this.dataSource.transaction(async (manager) => {
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
				`invoice-credit:${tenantId}:${invoiceId}`,
			]);
			const invoices = (await manager.query(
				`
				SELECT id, customer_account_id AS "customerAccountId", currency,
					status, total, amount_paid AS "amountPaid",
					amount_credited AS "amountCredited"
				FROM invoices
				WHERE tenant_id = $1 AND id = $2
				FOR UPDATE
				`,
				[tenantId, invoiceId],
			)) as InvoiceRow[];
			const invoice = invoices[0];
			if (invoice === undefined) {
				throw new NotFoundException("Invoice not found.");
			}
			if (
				invoice.status !== InvoiceStatus.OPEN &&
				invoice.status !== InvoiceStatus.PARTIALLY_PAID
			) {
				throw new ConflictException(
					"Credit notes can only be issued against open invoices.",
				);
			}
			const precision = currencyPrecision(invoice.currency);
			if (precision === null) {
				throw new UnprocessableEntityException(
					`Currency ${invoice.currency} is not supported.`,
				);
			}
			const noteAmount = roundToCurrency(amount, precision);
			if (noteAmount === 0n) {
				throw new UnprocessableEntityException(
					"The credit rounds to zero at this currency's precision.",
				);
			}
			const total = parseDecimal(invoice.total) ?? 0n;
			const paid = parseDecimal(invoice.amountPaid) ?? 0n;
			const credited = parseDecimal(invoice.amountCredited) ?? 0n;
			const remaining = total - paid - credited;
			if (noteAmount > remaining) {
				throw new UnprocessableEntityException(
					"The credit exceeds the invoice's remaining creditable amount.",
				);
			}
			const lines = await this.validateCreditNoteLines(
				manager,
				tenantId,
				invoice.id,
				noteAmount,
				precision,
				dto,
			);
			const issuedAt = new Date();
			const creditNoteNumber = await this.allocateCreditNoteNumber(
				manager,
				tenantId,
				issuedAt,
			);
			const inserted = (await manager.query(
				`
				INSERT INTO credit_notes (
					tenant_id, customer_account_id, invoice_id, credit_note_number,
					currency, amount, reason, status, issued_at
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, 'issued', $8)
				RETURNING id
				`,
				[
					tenantId,
					invoice.customerAccountId,
					invoice.id,
					creditNoteNumber,
					invoice.currency,
					formatDecimal(noteAmount),
					dto.reason,
					issuedAt,
				],
			)) as Array<{ id: string }>;
			const creditNoteId = inserted[0]?.id;
			if (creditNoteId === undefined) {
				throw new Error("The credit note could not be created.");
			}
			let lineNumber = 1;
			for (const line of lines) {
				await manager.query(
					`
					INSERT INTO credit_note_lines (
						tenant_id, credit_note_id, line_number, invoice_line_id,
						description, amount
					)
					VALUES ($1, $2, $3, $4, $5, $6)
					`,
					[
						tenantId,
						creditNoteId,
						lineNumber,
						line.invoiceLineId,
						line.description,
						formatDecimal(line.amount),
					],
				);
				lineNumber += 1;
			}
			const newCredited = credited + noteAmount;
			const newDue = total - paid - newCredited;
			const status =
				newDue === 0n
					? InvoiceStatus.CREDITED
					: paid > 0n
						? InvoiceStatus.PARTIALLY_PAID
						: InvoiceStatus.OPEN;
			await manager.query(
				`
				UPDATE invoices
				SET amount_credited = $3, amount_due = $4, status = $5, updated_at = now()
				WHERE tenant_id = $1 AND id = $2
				`,
				[
					tenantId,
					invoice.id,
					formatDecimal(newCredited),
					formatDecimal(newDue),
					status,
				],
			);
			await this.audit.record(
				{
					tenantId,
					actorType: ActorType.HUMAN,
					actorId: identityId,
					action: "credit_note.issued",
					resourceType: "credit_note",
					resourceId: creditNoteId,
					reason: dto.reason,
					metadata: {
						invoiceId: invoice.id,
						amount: formatDecimal(noteAmount),
						currency: invoice.currency,
					},
				},
				manager,
			);
			return {
				id: creditNoteId,
				customerAccountId: invoice.customerAccountId,
				invoiceId: invoice.id,
				creditNoteNumber,
				currency: invoice.currency,
				amount: formatDecimal(noteAmount),
				reason: dto.reason,
				status: CreditNoteStatus.ISSUED,
				issuedAt: issuedAt.toISOString(),
				createdAt: issuedAt.toISOString(),
				lines: lines.map((line, index) => ({
					id: "",
					lineNumber: index + 1,
					invoiceLineId: line.invoiceLineId,
					description: line.description,
					amount: formatDecimal(line.amount),
				})),
			} satisfies CreditNoteBody;
		});
		return this.getCreditNote(tenantId, note.id);
	}

	async listCreditNotes(
		tenantId: string,
		query: ListCreditNotesQueryDto,
	): Promise<CreditNoteBody[]> {
		const notes = await this.creditNotes.find({
			where: {
				tenantId,
				...(query.invoiceId === undefined
					? {}
					: { invoiceId: query.invoiceId }),
			},
			order: { createdAt: "DESC" },
			take: query.limit ?? 50,
		});
		return this.withLines(tenantId, notes);
	}

	async getCreditNote(
		tenantId: string,
		creditNoteId: string,
	): Promise<CreditNoteBody> {
		const note = await this.creditNotes.findOneBy({
			tenantId,
			id: creditNoteId,
		});
		if (note === null) {
			throw new NotFoundException("Credit note not found.");
		}
		const [body] = await this.withLines(tenantId, [note]);
		if (body === undefined) {
			throw new NotFoundException("Credit note not found.");
		}
		return body;
	}

	async voidInvoice(
		tenantId: string,
		identityId: string,
		invoiceId: string,
		dto: VoidInvoiceDto,
	): Promise<{
		id: string;
		status: InvoiceStatus;
		amountDue: string;
	}> {
		const amountDue = await this.dataSource.transaction(async (manager) => {
			const invoices = (await manager.query(
				`
				SELECT id, status, amount_paid AS "amountPaid",
					amount_credited AS "amountCredited"
				FROM invoices
				WHERE tenant_id = $1 AND id = $2
				FOR UPDATE
				`,
				[tenantId, invoiceId],
			)) as Pick<
				InvoiceRow,
				"id" | "status" | "amountPaid" | "amountCredited"
			>[];
			const invoice = invoices[0];
			if (invoice === undefined) {
				throw new NotFoundException("Invoice not found.");
			}
			if (
				invoice.status !== InvoiceStatus.OPEN &&
				invoice.status !== InvoiceStatus.PARTIALLY_PAID
			) {
				throw new ConflictException("Only open invoices can be voided.");
			}
			if ((parseDecimal(invoice.amountPaid) ?? 0n) > 0n) {
				throw new ConflictException(
					"An invoice with allocated payments cannot be voided.",
				);
			}
			if ((parseDecimal(invoice.amountCredited) ?? 0n) > 0n) {
				throw new ConflictException(
					"An invoice with credit notes cannot be voided.",
				);
			}
			await manager.query(
				`
				UPDATE invoices
				SET status = 'void', amount_due = 0, updated_at = now()
				WHERE tenant_id = $1 AND id = $2
				`,
				[tenantId, invoice.id],
			);
			await this.audit.record(
				{
					tenantId,
					actorType: ActorType.HUMAN,
					actorId: identityId,
					action: "invoice.voided",
					resourceType: "invoice",
					resourceId: invoice.id,
					reason: dto.reason,
				},
				manager,
			);
			return "0";
		});
		return { id: invoiceId, status: InvoiceStatus.VOID, amountDue };
	}

	async createAdjustment(
		tenantId: string,
		identityId: string,
		dto: CreateAdjustmentDto,
	): Promise<AdjustmentBody> {
		const amount = this.requireAmount(dto.amount, "amount");
		const currency = dto.currency.toUpperCase();
		const precision = currencyPrecision(currency);
		if (precision === null) {
			throw new UnprocessableEntityException(
				`Currency ${currency} is not supported.`,
			);
		}
		if (roundToCurrency(amount, precision) === 0n) {
			throw new UnprocessableEntityException(
				"The adjustment rounds to zero at this currency's precision.",
			);
		}
		const customer = await this.customers.findOneBy({
			tenantId,
			id: dto.customerAccountId,
		});
		if (customer === null) {
			throw new NotFoundException("Customer account not found.");
		}
		if (dto.subscriptionId !== undefined) {
			const subscription = await this.subscriptions.findOneBy({
				tenantId,
				id: dto.subscriptionId,
			});
			if (
				subscription === null ||
				subscription.customerAccountId !== customer.id
			) {
				throw new UnprocessableEntityException(
					"The subscription does not belong to this customer.",
				);
			}
		}
		const adjustment = this.adjustments.create({
			tenantId,
			customerAccountId: customer.id,
			subscriptionId: dto.subscriptionId ?? null,
			invoiceId: null,
			adjustmentType: dto.adjustmentType,
			amount: formatDecimal(amount),
			currency,
			reason: dto.reason,
			status: AdjustmentStatus.PENDING,
			idempotencyKey: dto.idempotencyKey,
			createdBy: identityId,
			appliedAt: null,
		});
		try {
			await this.adjustments.save(adjustment);
		} catch (error: unknown) {
			if (!isUniqueViolation(error)) {
				throw error;
			}
			const existing = await this.adjustments.findOneBy({
				tenantId,
				idempotencyKey: dto.idempotencyKey,
			});
			if (
				existing === null ||
				existing.customerAccountId !== customer.id ||
				existing.adjustmentType !== dto.adjustmentType ||
				existing.currency !== currency ||
				(existing.subscriptionId ?? null) !== (dto.subscriptionId ?? null) ||
				(parseDecimal(existing.amount) ?? 0n) !== amount
			) {
				throw new ConflictException(
					"The idempotency key was already used with different adjustment details.",
				);
			}
			return this.toAdjustmentBody(existing);
		}
		await this.audit.record({
			tenantId,
			actorType: ActorType.HUMAN,
			actorId: identityId,
			action: "billing_adjustment.created",
			resourceType: "billing_adjustment",
			resourceId: adjustment.id,
			reason: dto.reason,
			metadata: {
				adjustmentType: dto.adjustmentType,
				amount: formatDecimal(amount),
				currency,
			},
		});
		return this.toAdjustmentBody(adjustment);
	}

	async listAdjustments(
		tenantId: string,
		query: ListAdjustmentsQueryDto,
	): Promise<AdjustmentBody[]> {
		const adjustments = await this.adjustments.find({
			where: {
				tenantId,
				...(query.status === undefined ? {} : { status: query.status }),
				...(query.customerAccountId === undefined
					? {}
					: { customerAccountId: query.customerAccountId }),
			},
			order: { createdAt: "DESC" },
			take: query.limit ?? 50,
		});
		return adjustments.map((adjustment) => this.toAdjustmentBody(adjustment));
	}

	private async validateCreditNoteLines(
		manager: import("typeorm").EntityManager,
		tenantId: string,
		invoiceId: string,
		amount: bigint,
		precision: number,
		dto: CreateCreditNoteDto,
	): Promise<
		Array<{
			invoiceLineId: string | null;
			description: string;
			amount: bigint;
		}>
	> {
		if (dto.lines === undefined) {
			return [
				{
					invoiceLineId: null,
					description: dto.reason,
					amount,
				},
			];
		}
		const lines: Array<{
			invoiceLineId: string | null;
			description: string;
			amount: bigint;
		}> = [];
		let total = 0n;
		for (const line of dto.lines) {
			const lineAmount = roundToCurrency(
				this.requireAmount(line.amount, "line amount"),
				precision,
			);
			if (lineAmount === 0n) {
				throw new UnprocessableEntityException(
					"A credit note line rounds to zero at this currency's precision.",
				);
			}
			if (line.invoiceLineId !== undefined) {
				const matches = (await manager.query(
					`
					SELECT id FROM invoice_line_items
					WHERE tenant_id = $1 AND invoice_id = $2 AND id = $3
					`,
					[tenantId, invoiceId, line.invoiceLineId],
				)) as Array<{ id: string }>;
				if (matches[0] === undefined) {
					throw new UnprocessableEntityException(
						"An invoice line does not belong to this invoice.",
					);
				}
			}
			total += lineAmount;
			lines.push({
				invoiceLineId: line.invoiceLineId ?? null,
				description: line.description,
				amount: lineAmount,
			});
		}
		if (total !== amount) {
			throw new UnprocessableEntityException(
				"Credit note line amounts must equal the credit note amount.",
			);
		}
		return lines;
	}

	private async allocateCreditNoteNumber(
		manager: import("typeorm").EntityManager,
		tenantId: string,
		issuedAt: Date,
	): Promise<string> {
		await manager.query(
			`
			INSERT INTO credit_note_number_sequences (tenant_id, next_number)
			VALUES ($1, 1)
			ON CONFLICT (tenant_id) DO NOTHING
			`,
			[tenantId],
		);
		const result = await manager.query(
			`
			UPDATE credit_note_number_sequences
			SET next_number = next_number + 1, updated_at = now()
			WHERE tenant_id = $1
			RETURNING next_number - 1 AS number
			`,
			[tenantId],
		);
		const rows = returnedRows<{ number: string }>(result);
		const number = rows[0]?.number;
		if (number === undefined) {
			throw new Error("A credit note number could not be allocated.");
		}
		return `CN-${issuedAt.getUTCFullYear()}-${number.padStart(6, "0")}`;
	}

	private requireAmount(raw: string, field: string): bigint {
		const parsed = parseDecimal(raw);
		if (parsed === null || parsed === 0n) {
			throw new UnprocessableEntityException(
				`${field} must be a positive decimal.`,
			);
		}
		return parsed;
	}

	private async withLines(
		tenantId: string,
		notes: CreditNote[],
	): Promise<CreditNoteBody[]> {
		if (notes.length === 0) {
			return [];
		}
		const lines = await this.creditNoteLines.find({
			where: {
				tenantId,
				creditNoteId: In(notes.map((note) => note.id)),
			},
			order: { lineNumber: "ASC" },
		});
		const byNote = new Map<string, CreditNoteLine[]>();
		for (const line of lines) {
			const group = byNote.get(line.creditNoteId) ?? [];
			group.push(line);
			byNote.set(line.creditNoteId, group);
		}
		return notes.map((note) =>
			this.toCreditNoteBody(note, byNote.get(note.id) ?? []),
		);
	}

	private toCreditNoteBody(
		note: CreditNote,
		lines: CreditNoteLine[],
	): CreditNoteBody {
		return {
			id: note.id,
			customerAccountId: note.customerAccountId,
			invoiceId: note.invoiceId,
			creditNoteNumber: note.creditNoteNumber,
			currency: note.currency,
			amount: this.normalizeMoney(note.amount),
			reason: note.reason,
			status: note.status,
			issuedAt: note.issuedAt.toISOString(),
			createdAt: note.createdAt.toISOString(),
			lines: lines.map((line) => ({
				id: line.id,
				lineNumber: line.lineNumber,
				invoiceLineId: line.invoiceLineId,
				description: line.description,
				amount: this.normalizeMoney(line.amount),
			})),
		};
	}

	private toAdjustmentBody(adjustment: BillingAdjustment): AdjustmentBody {
		return {
			id: adjustment.id,
			customerAccountId: adjustment.customerAccountId,
			subscriptionId: adjustment.subscriptionId,
			invoiceId: adjustment.invoiceId,
			adjustmentType: adjustment.adjustmentType,
			amount: this.normalizeMoney(adjustment.amount),
			currency: adjustment.currency,
			reason: adjustment.reason,
			status: adjustment.status,
			idempotencyKey: adjustment.idempotencyKey,
			createdBy: adjustment.createdBy,
			appliedAt:
				adjustment.appliedAt === null
					? null
					: adjustment.appliedAt.toISOString(),
			createdAt: adjustment.createdAt.toISOString(),
		};
	}

	private normalizeMoney(raw: string): string {
		const parsed = parseDecimal(raw);
		return parsed === null ? raw : formatDecimal(parsed);
	}
}

function returnedRows<T>(result: unknown): T[] {
	if (Array.isArray(result) && Array.isArray(result[0])) {
		return result[0] as T[];
	}
	return (result as T[]) ?? [];
}
