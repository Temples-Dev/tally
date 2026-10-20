import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { AggregationMethod } from "../catalog/enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "../identity/audit.service";
import { ActorType } from "../identity/enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BackgroundJobsService } from "../jobs/background-jobs.service";
import { CustomerAccount } from "../subscriptions/entities/customer-account.entity";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import {
	currencyPrecision,
	formatDecimal,
	maxAmount,
	multiplyAmount,
	parseDecimal,
	roundToCurrency,
	sumAmounts,
} from "./billing-money";
import type {
	CreateBillingPeriodDto,
	ListBillingPeriodsQueryDto,
	ListInvoicesQueryDto,
} from "./billing.dto";
import { BillingPeriod } from "./entities/billing-period.entity";
import { InvoiceLineItem } from "./entities/invoice-line-item.entity";
import { Invoice } from "./entities/invoice.entity";
import {
	AdjustmentType,
	BillingCalculationStatus,
	type BillingOperationStatus,
	BillingPeriodStatus,
	InvoiceLineType,
	type InvoiceStatus,
	PricingModel,
} from "./enums";

export const BILLING_INVOICE_JOB = "billing.invoice.generate";

const DUE_DAYS = 30;

export interface BillingPeriodBody {
	id: string;
	subscriptionId: string;
	periodStart: string;
	periodEnd: string;
	status: BillingPeriodStatus;
	calculationVersion: number;
	completedAt: string | null;
	createdAt: string;
	invoiceId: string | null;
	invoiceNumber: string | null;
	invoiceStatus: InvoiceStatus | null;
	invoiceTotal: string | null;
}

export interface BillingOperationBody {
	id: string;
	operationType: string;
	sourceType: string;
	sourceId: string | null;
	idempotencyKey: string;
	status: BillingOperationStatus;
	attemptCount: number;
	lastErrorCode: string | null;
	invoiceId: string | null;
	createdAt: string;
	updatedAt: string;
}

interface OperationRow {
	id: string;
	operationType: string;
	sourceType: string;
	sourceId: string | null;
	idempotencyKey: string;
	status: BillingOperationStatus;
	attemptCount: number;
	lastErrorCode: string | null;
	invoiceId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

interface AdjustmentRow {
	id: string;
	adjustmentType: AdjustmentType;
	amount: string;
	reason: string;
}

export interface InvoiceBody {
	id: string;
	invoiceNumber: string;
	status: InvoiceStatus;
	customerAccountId: string;
	billingPeriodId: string | null;
	currency: string;
	periodStart: string | null;
	periodEnd: string | null;
	subtotal: string;
	discountTotal: string;
	taxTotal: string;
	total: string;
	amountPaid: string;
	amountCredited: string;
	amountDue: string;
	issuedAt: string | null;
	dueAt: string | null;
	createdAt: string;
	billingProfile: Record<string, unknown>;
}

export interface InvoiceLineBody {
	id: string;
	lineNumber: number;
	lineType: InvoiceLineType;
	description: string;
	quantity: string;
	unitPrice: string;
	amount: string;
	currency: string;
	sourceType: string | null;
	sourceId: string | null;
	priceId: string | null;
	metadata: Record<string, unknown>;
}

interface PeriodRow {
	id: string;
	subscriptionId: string;
	periodStart: Date;
	periodEnd: Date;
	status: BillingPeriodStatus;
	calculationVersion: number;
	completedAt: Date | null;
	createdAt: Date;
}

interface InvoiceRow {
	id: string;
	invoiceNumber: string;
	status: InvoiceStatus;
	customerAccountId: string;
	billingPeriodId: string | null;
	currency: string;
	periodStart: Date | null;
	periodEnd: Date | null;
	subtotal: string;
	discountTotal: string;
	taxTotal: string;
	total: string;
	amountPaid: string;
	amountCredited: string;
	amountDue: string;
	issuedAt: Date | null;
	dueAt: Date | null;
	createdAt: Date;
	billingProfileSnapshot: Record<string, unknown>;
}

interface LineRow {
	id: string;
	lineNumber: number;
	lineType: InvoiceLineType;
	description: string;
	quantity: string;
	unitPrice: string;
	amount: string;
	currency: string;
	sourceType: string | null;
	sourceId: string | null;
	priceId: string | null;
	metadata: Record<string, unknown>;
}

interface BillableItemRow {
	itemId: string;
	quantity: string;
	description: string | null;
	priceId: string;
	priceCode: string;
	versionNumber: number;
	currency: string;
	pricingModel: PricingModel;
	configuration: Record<string, unknown>;
}

interface ChargeLine {
	lineType: InvoiceLineType;
	description: string;
	quantity: bigint;
	unitPrice: bigint;
	amount: bigint;
	sourceType: string;
	sourceId: string;
	priceId: string | null;
	metadata: Record<string, unknown>;
}

@Injectable()
export class BillingService {
	constructor(
		@InjectRepository(BillingPeriod)
		private readonly periods: Repository<BillingPeriod>,
		@InjectRepository(Invoice)
		private readonly invoices: Repository<Invoice>,
		@InjectRepository(InvoiceLineItem)
		private readonly lines: Repository<InvoiceLineItem>,
		@InjectRepository(Subscription)
		private readonly subscriptions: Repository<Subscription>,
		@InjectRepository(CustomerAccount)
		private readonly customers: Repository<CustomerAccount>,
		@InjectRepository(UsageMetric)
		private readonly metrics: Repository<UsageMetric>,
		private readonly dataSource: DataSource,
		private readonly jobs: BackgroundJobsService,
		private readonly audit: AuditService,
	) {}

	async createPeriod(
		tenantId: string,
		identityId: string,
		dto: CreateBillingPeriodDto,
	): Promise<BillingPeriodBody> {
		const subscription = await this.subscriptions.findOneBy({
			tenantId,
			id: dto.subscriptionId,
		});
		if (subscription === null) {
			throw new NotFoundException("Subscription not found.");
		}
		if ((dto.periodStart === undefined) !== (dto.periodEnd === undefined)) {
			throw new UnprocessableEntityException(
				"periodStart and periodEnd must be supplied together.",
			);
		}
		let periodStart: Date;
		let periodEnd: Date;
		if (dto.periodStart !== undefined && dto.periodEnd !== undefined) {
			periodStart = new Date(dto.periodStart);
			periodEnd = new Date(dto.periodEnd);
		} else {
			if (
				subscription.currentPeriodStart === null ||
				subscription.currentPeriodEnd === null
			) {
				throw new UnprocessableEntityException(
					"The subscription does not have an active billing period.",
				);
			}
			periodStart = subscription.currentPeriodStart;
			periodEnd = subscription.currentPeriodEnd;
		}
		if (
			Number.isNaN(periodStart.getTime()) ||
			Number.isNaN(periodEnd.getTime()) ||
			periodEnd.getTime() <= periodStart.getTime()
		) {
			throw new UnprocessableEntityException(
				"periodEnd must be later than periodStart.",
			);
		}

		const existing = await this.periods.findOneBy({
			tenantId,
			subscriptionId: subscription.id,
			periodStart,
			periodEnd,
		});
		if (existing !== null) {
			return this.toPeriodBody(existing);
		}
		const period = this.periods.create({
			tenantId,
			subscriptionId: subscription.id,
			periodStart,
			periodEnd,
			status: BillingPeriodStatus.OPEN,
			calculationVersion: 1,
			completedAt: null,
		});
		try {
			await this.periods.save(period);
		} catch {
			const raced = await this.periods.findOneBy({
				tenantId,
				subscriptionId: subscription.id,
				periodStart,
				periodEnd,
			});
			if (raced === null) {
				throw new ConflictException("The billing period could not be created.");
			}
			return this.toPeriodBody(raced);
		}
		await this.audit.record({
			tenantId,
			actorType: ActorType.HUMAN,
			actorId: identityId,
			action: "billing_period.created",
			resourceType: "billing_period",
			resourceId: period.id,
			metadata: {
				subscriptionId: subscription.id,
				periodStart: periodStart.toISOString(),
				periodEnd: periodEnd.toISOString(),
			},
		});
		return this.toPeriodBody(period);
	}

	async getPeriod(
		tenantId: string,
		periodId: string,
	): Promise<BillingPeriodBody> {
		const period = await this.periods.findOneBy({ tenantId, id: periodId });
		if (period === null) {
			throw new NotFoundException("Billing period not found.");
		}
		return this.toPeriodBody(period);
	}

	async listPeriods(
		tenantId: string,
		query: ListBillingPeriodsQueryDto,
	): Promise<BillingPeriodBody[]> {
		const rows = (await this.dataSource.query(
			`
			SELECT p.id, p.subscription_id AS "subscriptionId",
				p.period_start AS "periodStart", p.period_end AS "periodEnd",
				p.status, p.calculation_version AS "calculationVersion",
				p.completed_at AS "completedAt", p.created_at AS "createdAt",
				i.id AS "invoiceId", i.invoice_number AS "invoiceNumber",
				i.status AS "invoiceStatus", i.total AS "invoiceTotal"
			FROM billing_periods p
			LEFT JOIN invoices i
				ON i.tenant_id = p.tenant_id AND i.billing_period_id = p.id
			WHERE p.tenant_id = $1
				AND ($2::text IS NULL OR p.status = $2)
				AND ($3::uuid IS NULL OR p.subscription_id = $3)
				AND ($4::timestamptz IS NULL OR p.period_start >= $4)
				AND ($5::timestamptz IS NULL OR p.period_start <= $5)
			ORDER BY p.period_start DESC
			LIMIT $6
			`,
			[
				tenantId,
				query.status ?? null,
				query.subscriptionId ?? null,
				query.from === undefined ? null : new Date(query.from),
				query.to === undefined ? null : new Date(query.to),
				query.limit ?? 50,
			],
		)) as Array<
			PeriodRow & {
				invoiceId: string | null;
				invoiceNumber: string | null;
				invoiceStatus: InvoiceStatus | null;
				invoiceTotal: string | null;
			}
		>;
		return rows.map((row) => ({
			...this.toPeriodBody(row),
			invoiceId: row.invoiceId,
			invoiceNumber: row.invoiceNumber,
			invoiceStatus: row.invoiceStatus,
			invoiceTotal:
				row.invoiceTotal === null ? null : this.money(row.invoiceTotal),
		}));
	}

	async getOperation(
		tenantId: string,
		operationId: string,
	): Promise<BillingOperationBody> {
		const rows = (await this.dataSource.query(
			`
			SELECT id, operation_type AS "operationType",
				source_type AS "sourceType", source_id AS "sourceId",
				idempotency_key AS "idempotencyKey", status,
				attempt_count AS "attemptCount",
				last_error_code AS "lastErrorCode", invoice_id AS "invoiceId",
				created_at AS "createdAt", updated_at AS "updatedAt"
			FROM billing_operations
			WHERE tenant_id = $1 AND id = $2
			`,
			[tenantId, operationId],
		)) as OperationRow[];
		const row = rows[0];
		if (row === undefined) {
			throw new NotFoundException("Billing operation not found.");
		}
		return this.toOperationBody(row);
	}

	async requestInvoice(
		tenantId: string,
		periodId: string,
	): Promise<
		| { status: "existing"; invoice: InvoiceBody }
		| {
				status: "queued";
				jobId: string;
				operationId: string;
				billingPeriodId: string;
		  }
	> {
		const period = await this.periods.findOneBy({ tenantId, id: periodId });
		if (period === null) {
			throw new NotFoundException("Billing period not found.");
		}
		const existing = await this.invoices.findOneBy({
			tenantId,
			billingPeriodId: period.id,
		});
		if (existing !== null) {
			return { status: "existing", invoice: this.toInvoiceBody(existing) };
		}
		if (period.status !== BillingPeriodStatus.OPEN) {
			throw new ConflictException("The billing period is not open.");
		}
		const queued = await this.dataSource.transaction(async (manager) => {
			const operations = (await manager.query(
				`
				INSERT INTO billing_operations (
					tenant_id, operation_type, source_type, source_id,
					idempotency_key, status
				)
				VALUES ($1, $2, 'billing_period', $3, $4, 'pending')
				ON CONFLICT (tenant_id, idempotency_key)
				DO UPDATE SET
					status = CASE
						WHEN billing_operations.status = 'completed' THEN 'completed'
						WHEN billing_operations.status = 'running' THEN 'running'
						ELSE 'pending'
					END,
					updated_at = now()
				RETURNING id
				`,
				[
					tenantId,
					BILLING_INVOICE_JOB,
					period.id,
					`${BILLING_INVOICE_JOB}:${period.id}`,
				],
			)) as Array<{ id: string }>;
			const operationId = operations[0]?.id;
			if (operationId === undefined) {
				throw new Error("The billing operation could not be created.");
			}
			const job = await this.jobs.enqueue(
				{
					tenantId,
					jobType: BILLING_INVOICE_JOB,
					idempotencyKey: `${BILLING_INVOICE_JOB}:${period.id}`,
					payload: { tenantId, billingPeriodId: period.id },
				},
				manager,
			);
			return { operationId, jobId: job.id };
		});
		return {
			status: "queued",
			jobId: queued.jobId,
			operationId: queued.operationId,
			billingPeriodId: period.id,
		};
	}

	async generateInvoice(
		tenantId: string,
		billingPeriodId: string,
	): Promise<InvoiceBody> {
		const operation = await this.claimOperation(tenantId, billingPeriodId);
		try {
			const invoice = await this.dataSource.transaction(async (manager) => {
				await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
					`billing-period:${billingPeriodId}`,
				]);
				const periodRows = (await manager.query(
					`
				SELECT id, subscription_id AS "subscriptionId",
					period_start AS "periodStart", period_end AS "periodEnd",
					status, calculation_version AS "calculationVersion",
					completed_at AS "completedAt", created_at AS "createdAt"
				FROM billing_periods
				WHERE tenant_id = $1 AND id = $2
				FOR UPDATE
				`,
					[tenantId, billingPeriodId],
				)) as PeriodRow[];
				const period = periodRows[0];
				if (period === undefined) {
					throw new NotFoundException("Billing period not found.");
				}
				const existing = await this.findInvoiceByPeriod(
					manager,
					tenantId,
					period.id,
				);
				if (existing !== null) {
					return this.toInvoiceBody(existing);
				}
				if (period.status !== BillingPeriodStatus.OPEN) {
					throw new ConflictException("The billing period is not open.");
				}
				const subscription = await manager
					.getRepository(Subscription)
					.findOneBy({ tenantId, id: period.subscriptionId });
				if (subscription === null) {
					throw new NotFoundException("Subscription not found.");
				}
				const customer = await manager
					.getRepository(CustomerAccount)
					.findOneBy({ tenantId, id: subscription.customerAccountId });
				if (customer === null) {
					throw new NotFoundException("Customer account not found.");
				}
				const items = (await manager.query(
					`
				SELECT i.id AS "itemId", i.quantity, i.description,
					p.id AS "priceId", p.price_code AS "priceCode",
					p.version_number AS "versionNumber", p.currency,
					p.pricing_model AS "pricingModel", p.configuration
				FROM subscription_items i
				JOIN prices p
					ON p.tenant_id = i.tenant_id AND p.id = i.price_id
				WHERE i.tenant_id = $1 AND i.subscription_id = $2
				ORDER BY p.price_code ASC
				`,
					[tenantId, subscription.id],
				)) as BillableItemRow[];
				if (items.length === 0) {
					throw new UnprocessableEntityException(
						"The subscription has no billable items.",
					);
				}
				const currencies = new Set(
					items.map((item) => item.currency.toUpperCase()),
				);
				if (currencies.size !== 1) {
					throw new UnprocessableEntityException(
						"All subscription items must share one invoice currency.",
					);
				}
				const currency = [...currencies][0] ?? "";
				const precision = currencyPrecision(currency);
				if (precision === null) {
					throw new UnprocessableEntityException(
						`Currency ${currency} is not supported.`,
					);
				}

				const lines: ChargeLine[] = [];
				const usageSnapshot: Array<Record<string, unknown>> = [];
				for (const item of items) {
					const line = await this.calculateLine(
						manager,
						tenantId,
						subscription,
						period,
						item,
						precision,
						usageSnapshot,
					);
					lines.push(line);
				}
				if (lines.length === 0) {
					throw new UnprocessableEntityException(
						"No billable charges were found for this period.",
					);
				}
				const adjustmentsSnapshot = await this.applyAdjustments(
					manager,
					tenantId,
					subscription,
					period,
					currency,
					precision,
					lines,
				);
				const subtotal = sumAmounts(lines.map((line) => line.amount));
				if (subtotal < 0n) {
					throw new UnprocessableEntityException(
						"Billing adjustments exceed the invoice charges.",
					);
				}
				const invoiceNumber = await this.allocateInvoiceNumber(
					manager,
					tenantId,
					new Date(),
				);
				const issuedAt = new Date();
				const dueAt = new Date(issuedAt.getTime() + DUE_DAYS * 86_400_000);
				const profile = {
					displayName: customer.displayName,
					email: customer.email,
					customerAccountId: customer.id,
				};
				const inserted = (await manager.query(
					`
				INSERT INTO invoices (
					tenant_id, customer_account_id, billing_period_id, invoice_number,
					billing_profile_snapshot, currency, status, issued_at, due_at,
					period_start, period_end, subtotal, discount_total, tax_total,
					total, amount_paid, amount_credited, amount_due
				)
				VALUES (
					$1, $2, $3, $4, $5::jsonb, $6, 'open', $7, $8,
					$9, $10, $11, 0, 0, $11, 0, 0, $11
				)
				RETURNING id
				`,
					[
						tenantId,
						customer.id,
						period.id,
						invoiceNumber,
						JSON.stringify(profile),
						currency,
						issuedAt,
						dueAt,
						period.periodStart,
						period.periodEnd,
						formatDecimal(subtotal),
					],
				)) as Array<{ id: string }>;
				const invoiceId = inserted[0]?.id;
				if (invoiceId === undefined) {
					throw new Error("The invoice could not be created.");
				}
				const adjustmentIds = adjustmentsSnapshot.map(
					(adjustment) => adjustment.id,
				);
				if (adjustmentIds.length > 0) {
					await manager.query(
						`
					UPDATE billing_adjustments
					SET status = 'applied', invoice_id = $2, applied_at = now()
					WHERE tenant_id = $1 AND id = ANY($3::uuid[])
					`,
						[tenantId, invoiceId, adjustmentIds],
					);
				}
				let lineNumber = 1;
				for (const line of lines) {
					await manager.query(
						`
					INSERT INTO invoice_line_items (
						tenant_id, invoice_id, line_number, line_type, description,
						quantity, unit_price, amount, currency, source_type, source_id,
						price_id, metadata
					)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
					`,
						[
							tenantId,
							invoiceId,
							lineNumber,
							line.lineType,
							line.description,
							formatDecimal(line.quantity),
							formatDecimal(line.unitPrice),
							formatDecimal(line.amount),
							currency,
							line.sourceType,
							line.sourceId,
							line.priceId,
							JSON.stringify(line.metadata),
						],
					);
					lineNumber += 1;
				}
				await manager.query(
					`
				INSERT INTO billing_calculations (
					tenant_id, subscription_id, billing_period_id,
					pricing_version_reference, usage_snapshot_reference, currency,
					subtotal, discount_total, tax_total, total, calculation_version,
					status
				)
				VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 0, 0, $7, $8, $9)
				`,
					[
						tenantId,
						subscription.id,
						period.id,
						JSON.stringify({
							items: items.map((item) => ({
								priceId: item.priceId,
								priceCode: item.priceCode,
								versionNumber: item.versionNumber,
								pricingModel: item.pricingModel,
								configuration: item.configuration,
							})),
							adjustments: adjustmentsSnapshot,
						}),
						JSON.stringify({ metrics: usageSnapshot }),
						currency,
						formatDecimal(subtotal),
						period.calculationVersion,
						BillingCalculationStatus.COMPLETED,
					],
				);
				await manager.query(
					`
				UPDATE billing_periods
				SET status = 'invoiced', completed_at = now(), updated_at = now()
				WHERE id = $1
				`,
					[period.id],
				);
				const invoice = await this.findInvoiceByPeriod(
					manager,
					tenantId,
					period.id,
				);
				if (invoice === null) {
					throw new Error("The invoice could not be loaded.");
				}
				await this.audit.record(
					{
						tenantId,
						actorType: ActorType.SYSTEM,
						action: "invoice.issued",
						resourceType: "invoice",
						resourceId: invoice.id,
						metadata: {
							billingPeriodId: period.id,
							invoiceNumber,
							total: formatDecimal(subtotal),
							currency,
						},
					},
					manager,
				);
				return this.toInvoiceBody(invoice);
			});
			await this.completeOperation(operation.id, invoice.id);
			return invoice;
		} catch (error: unknown) {
			await this.failOperation(operation.id, billingErrorCode(error));
			throw error;
		}
	}

	async listInvoices(
		tenantId: string,
		query: ListInvoicesQueryDto,
	): Promise<InvoiceBody[]> {
		const invoices = await this.invoices.find({
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
		return invoices.map((invoice) => this.toInvoiceBody(invoice));
	}

	async getInvoice(tenantId: string, invoiceId: string): Promise<InvoiceBody> {
		const invoice = await this.invoices.findOneBy({ tenantId, id: invoiceId });
		if (invoice === null) {
			throw new NotFoundException("Invoice not found.");
		}
		return this.toInvoiceBody(invoice);
	}

	async getInvoiceForPeriod(
		tenantId: string,
		periodId: string,
	): Promise<InvoiceBody> {
		const invoice = await this.invoices.findOneBy({
			tenantId,
			billingPeriodId: periodId,
		});
		if (invoice === null) {
			throw new NotFoundException("Invoice not found for this period.");
		}
		return this.toInvoiceBody(invoice);
	}

	async listLines(
		tenantId: string,
		invoiceId: string,
	): Promise<InvoiceLineBody[]> {
		const invoice = await this.invoices.findOneBy({ tenantId, id: invoiceId });
		if (invoice === null) {
			throw new NotFoundException("Invoice not found.");
		}
		const lines = await this.lines.find({
			where: { tenantId, invoiceId },
			order: { lineNumber: "ASC" },
		});
		return lines.map((line) => this.toLineBody(line));
	}

	private async applyAdjustments(
		manager: import("typeorm").EntityManager,
		tenantId: string,
		subscription: Subscription,
		period: PeriodRow,
		currency: string,
		precision: number,
		lines: ChargeLine[],
	): Promise<Array<Record<string, unknown>>> {
		const rows = (await manager.query(
			`
			SELECT id, adjustment_type AS "adjustmentType", amount, reason
			FROM billing_adjustments
			WHERE tenant_id = $1 AND customer_account_id = $2
				AND currency = $3 AND status = 'pending'
				AND (subscription_id IS NULL OR subscription_id = $4)
				AND created_at <= $5
			ORDER BY created_at ASC
			FOR UPDATE
			`,
			[
				tenantId,
				subscription.customerAccountId,
				currency,
				subscription.id,
				period.periodEnd,
			],
		)) as AdjustmentRow[];
		const snapshot: Array<Record<string, unknown>> = [];
		for (const adjustment of rows) {
			const parsed = parseDecimal(adjustment.amount) ?? 0n;
			const amount = roundToCurrency(parsed, precision);
			if (amount === 0n) {
				continue;
			}
			const signed =
				adjustment.adjustmentType === AdjustmentType.CREDIT ? -amount : amount;
			lines.push({
				lineType:
					adjustment.adjustmentType === AdjustmentType.CREDIT
						? InvoiceLineType.CREDIT
						: InvoiceLineType.ADJUSTMENT,
				description: `${adjustment.adjustmentType === AdjustmentType.CREDIT ? "Credit" : "Adjustment"}: ${adjustment.reason}`,
				quantity: parseDecimal("1") ?? 1n,
				unitPrice: amount,
				amount: signed,
				sourceType: "billing_adjustment",
				sourceId: adjustment.id,
				priceId: null,
				metadata: {
					adjustmentId: adjustment.id,
					adjustmentType: adjustment.adjustmentType,
					reason: adjustment.reason,
				},
			});
			snapshot.push({
				id: adjustment.id,
				adjustmentType: adjustment.adjustmentType,
				amount: formatDecimal(amount),
				reason: adjustment.reason,
			});
		}
		return snapshot;
	}

	private async calculateLine(
		manager: import("typeorm").EntityManager,
		tenantId: string,
		subscription: Subscription,
		period: PeriodRow,
		item: BillableItemRow,
		precision: number,
		usageSnapshot: Array<Record<string, unknown>>,
	): Promise<ChargeLine> {
		const configuration = item.configuration;
		if (item.pricingModel === PricingModel.FLAT) {
			const amount = this.configurationAmount(configuration, "amount");
			return {
				lineType: InvoiceLineType.FLAT,
				description: item.description ?? `${item.priceCode} recurring fee`,
				quantity: parseDecimal("1") ?? 1n,
				unitPrice: amount,
				amount: roundToCurrency(amount, precision),
				sourceType: "price",
				sourceId: item.priceId,
				priceId: item.priceId,
				metadata: this.priceMetadata(item),
			};
		}
		if (item.pricingModel === PricingModel.PER_UNIT) {
			const unitPrice = this.configurationAmount(configuration, "unitAmount");
			const quantity = parseDecimal(item.quantity);
			if (quantity === null) {
				throw new UnprocessableEntityException(
					"The subscription item quantity is invalid.",
				);
			}
			return {
				lineType: InvoiceLineType.PER_UNIT,
				description: item.description ?? `${item.priceCode} per-unit charge`,
				quantity,
				unitPrice,
				amount: multiplyAmount(quantity, unitPrice, precision),
				sourceType: "price",
				sourceId: item.priceId,
				priceId: item.priceId,
				metadata: this.priceMetadata(item),
			};
		}
		const metricId = configuration.metricId;
		if (typeof metricId !== "string") {
			throw new UnprocessableEntityException(
				"The metered price is missing metricId.",
			);
		}
		const metric = await manager
			.getRepository(UsageMetric)
			.findOneBy({ tenantId, id: metricId });
		if (metric === null) {
			throw new NotFoundException("Usage metric not found.");
		}
		if (metric.aggregationMethod !== AggregationMethod.SUM) {
			throw new UnprocessableEntityException(
				"Metered billing currently requires a sum-aggregated metric.",
			);
		}
		const aggregateRows = (await manager.query(
			`
			SELECT COALESCE(SUM(value), 0)::text AS total
			FROM usage_aggregates
			WHERE tenant_id = $1 AND subscription_id = $2 AND metric_id = $3
				AND period_start >= $4 AND period_end <= $5
			`,
			[
				tenantId,
				subscription.id,
				metricId,
				period.periodStart,
				period.periodEnd,
			],
		)) as Array<{ total: string }>;
		const measured = parseDecimal(aggregateRows[0]?.total ?? "0") ?? 0n;
		const included =
			configuration.includedUnits === undefined
				? 0n
				: this.configurationAmount(configuration, "includedUnits");
		const billable = maxAmount(measured - included, 0n);
		const unitPrice = this.configurationAmount(configuration, "unitAmount");
		usageSnapshot.push({
			metricId,
			metricCode: metric.code,
			measured: formatDecimal(measured),
			included: formatDecimal(included),
			billable: formatDecimal(billable),
			periodStart: period.periodStart.toISOString(),
			periodEnd: period.periodEnd.toISOString(),
		});
		return {
			lineType: InvoiceLineType.METERED,
			description: item.description ?? `${metric.name} usage`,
			quantity: billable,
			unitPrice,
			amount: multiplyAmount(billable, unitPrice, precision),
			sourceType: "usage_metric",
			sourceId: metricId,
			priceId: item.priceId,
			metadata: {
				...this.priceMetadata(item),
				measured: formatDecimal(measured),
				included: formatDecimal(included),
			},
		};
	}

	private priceMetadata(item: BillableItemRow): Record<string, unknown> {
		return {
			priceCode: item.priceCode,
			versionNumber: item.versionNumber,
			pricingModel: item.pricingModel,
			configuration: item.configuration,
		};
	}

	private configurationAmount(
		configuration: Record<string, unknown>,
		field: string,
	): bigint {
		const raw = configuration[field];
		const parsed = typeof raw === "string" ? parseDecimal(raw) : null;
		if (parsed === null) {
			throw new UnprocessableEntityException(
				`Price configuration ${field} is invalid.`,
			);
		}
		return parsed;
	}

	private async allocateInvoiceNumber(
		manager: import("typeorm").EntityManager,
		tenantId: string,
		issuedAt: Date,
	): Promise<string> {
		await manager.query(
			`
			INSERT INTO invoice_number_sequences (tenant_id, next_number)
			VALUES ($1, 1)
			ON CONFLICT (tenant_id) DO NOTHING
			`,
			[tenantId],
		);
		const result = await manager.query(
			`
			UPDATE invoice_number_sequences
			SET next_number = next_number + 1, updated_at = now()
			WHERE tenant_id = $1
			RETURNING next_number - 1 AS number
			`,
			[tenantId],
		);
		const rows = returnedRows<{ number: string }>(result);
		const number = rows[0]?.number;
		if (number === undefined) {
			throw new Error("An invoice number could not be allocated.");
		}
		return `INV-${issuedAt.getUTCFullYear()}-${number.padStart(6, "0")}`;
	}

	private async findInvoiceByPeriod(
		manager: import("typeorm").EntityManager,
		tenantId: string,
		billingPeriodId: string,
	): Promise<InvoiceRow | null> {
		const rows = (await manager.query(
			`
			${INVOICE_SELECT}
			WHERE tenant_id = $1 AND billing_period_id = $2
			LIMIT 1
			`,
			[tenantId, billingPeriodId],
		)) as InvoiceRow[];
		return rows[0] ?? null;
	}

	private async claimOperation(
		tenantId: string,
		billingPeriodId: string,
	): Promise<{ id: string }> {
		const rows = (await this.dataSource.query(
			`
			INSERT INTO billing_operations (
				tenant_id, operation_type, source_type, source_id,
				idempotency_key, status, attempt_count
			)
			VALUES ($1, $2, 'billing_period', $3, $4, 'running', 1)
			ON CONFLICT (tenant_id, idempotency_key)
			DO UPDATE SET
				status = 'running',
				attempt_count = billing_operations.attempt_count + 1,
				last_error_code = NULL,
				updated_at = now()
			RETURNING id
			`,
			[
				tenantId,
				BILLING_INVOICE_JOB,
				billingPeriodId,
				`${BILLING_INVOICE_JOB}:${billingPeriodId}`,
			],
		)) as Array<{ id: string }>;
		const operation = rows[0];
		if (operation === undefined) {
			throw new Error("The billing operation could not be claimed.");
		}
		return operation;
	}

	private async completeOperation(
		operationId: string,
		invoiceId: string,
	): Promise<void> {
		await this.dataSource.query(
			`
			UPDATE billing_operations
			SET status = 'completed', invoice_id = $2, last_error_code = NULL,
				updated_at = now()
			WHERE id = $1
			`,
			[operationId, invoiceId],
		);
	}

	private async failOperation(
		operationId: string,
		errorCode: string,
	): Promise<void> {
		await this.dataSource.query(
			`
			UPDATE billing_operations
			SET status = 'failed', last_error_code = $2, updated_at = now()
			WHERE id = $1
			`,
			[operationId, errorCode],
		);
	}

	private toOperationBody(row: OperationRow): BillingOperationBody {
		return {
			id: row.id,
			operationType: row.operationType,
			sourceType: row.sourceType,
			sourceId: row.sourceId,
			idempotencyKey: row.idempotencyKey,
			status: row.status,
			attemptCount: row.attemptCount,
			lastErrorCode: row.lastErrorCode,
			invoiceId: row.invoiceId,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	private toPeriodBody(period: BillingPeriod | PeriodRow): BillingPeriodBody {
		return {
			id: period.id,
			subscriptionId: period.subscriptionId,
			periodStart: period.periodStart.toISOString(),
			periodEnd: period.periodEnd.toISOString(),
			status: period.status,
			calculationVersion: period.calculationVersion,
			completedAt:
				period.completedAt === null ? null : period.completedAt.toISOString(),
			createdAt: period.createdAt.toISOString(),
			invoiceId: null,
			invoiceNumber: null,
			invoiceStatus: null,
			invoiceTotal: null,
		};
	}

	private toInvoiceBody(invoice: Invoice | InvoiceRow): InvoiceBody {
		const billingProfileSnapshot =
			invoice instanceof Invoice
				? invoice.billingProfileSnapshot
				: invoice.billingProfileSnapshot;
		return {
			id: invoice.id,
			invoiceNumber: invoice.invoiceNumber,
			status: invoice.status,
			customerAccountId: invoice.customerAccountId,
			billingPeriodId: invoice.billingPeriodId,
			currency: invoice.currency,
			periodStart: invoice.periodStart?.toISOString() ?? null,
			periodEnd: invoice.periodEnd?.toISOString() ?? null,
			subtotal: this.money(invoice.subtotal),
			discountTotal: this.money(invoice.discountTotal),
			taxTotal: this.money(invoice.taxTotal),
			total: this.money(invoice.total),
			amountPaid: this.money(invoice.amountPaid),
			amountCredited: this.money(invoice.amountCredited),
			amountDue: this.money(invoice.amountDue),
			issuedAt: invoice.issuedAt?.toISOString() ?? null,
			dueAt: invoice.dueAt?.toISOString() ?? null,
			createdAt: invoice.createdAt.toISOString(),
			billingProfile: billingProfileSnapshot,
		};
	}

	private toLineBody(line: InvoiceLineItem | LineRow): InvoiceLineBody {
		return {
			id: line.id,
			lineNumber: line.lineNumber,
			lineType: line.lineType,
			description: line.description,
			quantity: this.money(line.quantity),
			unitPrice: this.money(line.unitPrice),
			amount: this.money(line.amount),
			currency: line.currency,
			sourceType: line.sourceType,
			sourceId: line.sourceId,
			priceId: line.priceId,
			metadata: line.metadata,
		};
	}

	private money(raw: string): string {
		const parsed = parseDecimal(raw);
		return parsed === null ? raw : formatDecimal(parsed);
	}
}

function billingErrorCode(error: unknown): string {
	if (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		typeof error.code === "string"
	) {
		return error.code;
	}
	if (error instanceof Error) {
		return error.name;
	}
	return "UNKNOWN";
}

function returnedRows<T>(result: unknown): T[] {
	if (Array.isArray(result) && Array.isArray(result[0])) {
		return result[0] as T[];
	}
	return (result as T[]) ?? [];
}

const INVOICE_SELECT = `
	SELECT id, invoice_number AS "invoiceNumber", status,
		customer_account_id AS "customerAccountId",
		billing_period_id AS "billingPeriodId", currency,
		period_start AS "periodStart", period_end AS "periodEnd",
		subtotal, discount_total AS "discountTotal", tax_total AS "taxTotal",
		total, amount_paid AS "amountPaid",
		amount_credited AS "amountCredited", amount_due AS "amountDue",
		issued_at AS "issuedAt", due_at AS "dueAt", created_at AS "createdAt",
		billing_profile_snapshot AS "billingProfileSnapshot"
	FROM invoices
`;
