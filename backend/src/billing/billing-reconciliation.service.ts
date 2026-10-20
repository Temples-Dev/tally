import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "../identity/audit.service";
import { ActorType } from "../identity/enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BackgroundJobsService } from "../jobs/background-jobs.service";
import {
	currencyPrecision,
	formatDecimal,
	maxAmount,
	multiplyAmount,
	parseDecimal,
} from "./billing-money";
import type { ListDiscrepanciesQueryDto } from "./billing-reconciliation.dto";
import { BillingDiscrepancy } from "./entities/billing-discrepancy.entity";
import { BillingReconciliationRun } from "./entities/billing-reconciliation-run.entity";
import {
	DiscrepancyCategory,
	DiscrepancyStatus,
	ReconciliationRunStatus,
} from "./enums";

export const BILLING_RECONCILIATION_JOB = "billing.reconciliation.run";

export interface ReconciliationRunBody {
	id: string;
	status: ReconciliationRunStatus;
	requestedBy: string | null;
	invoicesChecked: number;
	discrepanciesFound: number;
	errorCode: string | null;
	startedAt: string;
	completedAt: string | null;
	createdAt: string;
}

export interface DiscrepancyBody {
	id: string;
	reconciliationRunId: string;
	category: DiscrepancyCategory;
	resourceType: string;
	resourceId: string | null;
	details: Record<string, unknown>;
	status: DiscrepancyStatus;
	resolutionNote: string | null;
	resolvedAt: string | null;
	createdAt: string;
}

interface ReconciliationRow {
	id: string;
	status: ReconciliationRunStatus;
	requestedBy: string | null;
	invoicesChecked: number;
	discrepanciesFound: number;
	errorCode: string | null;
	startedAt: Date;
	completedAt: Date | null;
	createdAt: Date;
}

interface MeteredLineRow {
	id: string;
	amount: string;
	unitPrice: string;
	metadata: Record<string, unknown>;
	currency: string;
	subscriptionId: string | null;
	periodStart: Date | null;
	periodEnd: Date | null;
}

@Injectable()
export class BillingReconciliationService {
	constructor(
		@InjectRepository(BillingReconciliationRun)
		private readonly runs: Repository<BillingReconciliationRun>,
		@InjectRepository(BillingDiscrepancy)
		private readonly discrepancies: Repository<BillingDiscrepancy>,
		private readonly dataSource: DataSource,
		private readonly jobs: BackgroundJobsService,
		private readonly audit: AuditService,
	) {}

	async start(
		tenantId: string,
		identityId: string,
	): Promise<ReconciliationRunBody> {
		const runId = await this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`
				INSERT INTO billing_reconciliation_runs (
					tenant_id, status, requested_by, started_at
				)
				VALUES ($1, 'running', $2, now())
				RETURNING id
				`,
				[tenantId, identityId],
			)) as Array<{ id: string }>;
			const id = rows[0]?.id;
			if (id === undefined) {
				throw new Error("The reconciliation run could not be created.");
			}
			await this.jobs.enqueue(
				{
					tenantId,
					jobType: BILLING_RECONCILIATION_JOB,
					idempotencyKey: `${BILLING_RECONCILIATION_JOB}:${id}`,
					payload: { tenantId, reconciliationRunId: id },
				},
				manager,
			);
			return id;
		});
		return this.getRun(tenantId, runId);
	}

	async listRuns(tenantId: string): Promise<ReconciliationRunBody[]> {
		const runs = await this.runs.find({
			where: { tenantId },
			order: { createdAt: "DESC" },
			take: 50,
		});
		return runs.map((run) => this.toRunBody(run));
	}

	async getRun(
		tenantId: string,
		runId: string,
	): Promise<ReconciliationRunBody> {
		const run = await this.runs.findOneBy({ tenantId, id: runId });
		if (run === null) {
			throw new NotFoundException("Reconciliation run not found.");
		}
		return this.toRunBody(run);
	}

	async listDiscrepancies(
		tenantId: string,
		query: ListDiscrepanciesQueryDto,
	): Promise<DiscrepancyBody[]> {
		const rows = await this.discrepancies.find({
			where: {
				tenantId,
				...(query.status === undefined ? {} : { status: query.status }),
				...(query.runId === undefined
					? {}
					: { reconciliationRunId: query.runId }),
			},
			order: { createdAt: "DESC" },
			take: query.limit ?? 50,
		});
		return rows.map((row) => this.toDiscrepancyBody(row));
	}

	async resolveDiscrepancy(
		tenantId: string,
		identityId: string,
		discrepancyId: string,
		status: DiscrepancyStatus,
		note: string,
	): Promise<DiscrepancyBody> {
		const discrepancy = await this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`
				SELECT id, reconciliation_run_id AS "reconciliationRunId",
					category, resource_type AS "resourceType",
					resource_id AS "resourceId", details, status,
					resolution_note AS "resolutionNote",
					resolved_at AS "resolvedAt", created_at AS "createdAt"
				FROM billing_discrepancies
				WHERE tenant_id = $1 AND id = $2
				FOR UPDATE
				`,
				[tenantId, discrepancyId],
			)) as Array<{
				id: string;
				reconciliationRunId: string;
				category: DiscrepancyCategory;
				resourceType: string;
				resourceId: string | null;
				details: Record<string, unknown>;
				status: DiscrepancyStatus;
				resolutionNote: string | null;
				resolvedAt: Date | null;
				createdAt: Date;
			}>;
			const row = rows[0];
			if (row === undefined) {
				throw new NotFoundException("Discrepancy not found.");
			}
			if (row.status !== DiscrepancyStatus.OPEN) {
				throw new ConflictException("The discrepancy is already resolved.");
			}
			await manager.query(
				`
				UPDATE billing_discrepancies
				SET status = $3, resolution_note = $4, resolved_at = now()
				WHERE tenant_id = $1 AND id = $2
				`,
				[tenantId, discrepancyId, status, note],
			);
			await this.audit.record(
				{
					tenantId,
					actorType: ActorType.HUMAN,
					actorId: identityId,
					action: "billing_discrepancy.resolved",
					resourceType: "billing_discrepancy",
					resourceId: discrepancyId,
					reason: note,
					metadata: { status, category: row.category },
				},
				manager,
			);
			return {
				...row,
				status,
				resolutionNote: note,
				resolvedAt: new Date(),
			};
		});
		return this.toDiscrepancyBody(discrepancy);
	}

	async execute(tenantId: string, runId: string): Promise<void> {
		const run = await this.runs.findOneBy({ tenantId, id: runId });
		if (run === null) {
			throw new NotFoundException("Reconciliation run not found.");
		}
		if (run.status === ReconciliationRunStatus.COMPLETED) {
			return;
		}
		try {
			await this.dataSource.transaction(async (manager) => {
				await manager.query(
					`
					UPDATE billing_reconciliation_runs
					SET status = 'running', started_at = now(), completed_at = NULL,
						error_code = NULL
					WHERE tenant_id = $1 AND id = $2
					`,
					[tenantId, runId],
				);
				await manager.query(
					"DELETE FROM billing_discrepancies WHERE reconciliation_run_id = $1",
					[runId],
				);

				const invoiceCount = (await manager.query(
					"SELECT COUNT(*)::int AS count FROM invoices WHERE tenant_id = $1",
					[tenantId],
				)) as Array<{ count: number }>;
				const discrepancies = await this.collectDiscrepancies(
					manager,
					tenantId,
				);
				for (const discrepancy of discrepancies) {
					await manager.query(
						`
						INSERT INTO billing_discrepancies (
							tenant_id, reconciliation_run_id, category, resource_type,
							resource_id, details, status
						)
						VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'open')
						`,
						[
							tenantId,
							runId,
							discrepancy.category,
							discrepancy.resourceType,
							discrepancy.resourceId,
							JSON.stringify(discrepancy.details),
						],
					);
				}
				await manager.query(
					`
					UPDATE billing_reconciliation_runs
					SET status = 'completed', invoices_checked = $3,
						discrepancies_found = $4, completed_at = now(),
						error_code = NULL
					WHERE tenant_id = $1 AND id = $2
					`,
					[tenantId, runId, invoiceCount[0]?.count ?? 0, discrepancies.length],
				);
				await this.audit.record(
					{
						tenantId,
						actorType: ActorType.SYSTEM,
						action: "billing_reconciliation.completed",
						resourceType: "billing_reconciliation_run",
						resourceId: runId,
						metadata: {
							invoicesChecked: invoiceCount[0]?.count ?? 0,
							discrepanciesFound: discrepancies.length,
						},
					},
					manager,
				);
			});
		} catch (error: unknown) {
			await this.dataSource.query(
				`
				UPDATE billing_reconciliation_runs
				SET status = 'failed', error_code = $3, completed_at = now()
				WHERE tenant_id = $1 AND id = $2
				`,
				[tenantId, runId, reconciliationErrorCode(error)],
			);
			throw error;
		}
	}

	private async collectDiscrepancies(
		manager: import("typeorm").EntityManager,
		tenantId: string,
	): Promise<
		Array<{
			category: DiscrepancyCategory;
			resourceType: string;
			resourceId: string | null;
			details: Record<string, unknown>;
		}>
	> {
		const output: Array<{
			category: DiscrepancyCategory;
			resourceType: string;
			resourceId: string | null;
			details: Record<string, unknown>;
		}> = [];
		const add = (
			category: DiscrepancyCategory,
			resourceType: string,
			resourceId: string | null,
			details: Record<string, unknown>,
		): void => {
			output.push({ category, resourceType, resourceId, details });
		};

		const lineTotals = (await manager.query(
			`
			SELECT i.id, i.subtotal::text AS "subtotal",
				COALESCE(SUM(l.amount), 0)::text AS "lineTotal"
			FROM invoices i
			LEFT JOIN invoice_line_items l
				ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
			WHERE i.tenant_id = $1
			GROUP BY i.id
			HAVING i.subtotal <> COALESCE(SUM(l.amount), 0)
			`,
			[tenantId],
		)) as Array<{ id: string; subtotal: string; lineTotal: string }>;
		for (const row of lineTotals) {
			add(DiscrepancyCategory.LINE_TOTAL_MISMATCH, "invoice", row.id, {
				subtotal: row.subtotal,
				lineTotal: row.lineTotal,
			});
		}

		const totals = (await manager.query(
			`
			SELECT id, total::text AS total, subtotal::text AS subtotal,
				discount_total::text AS "discountTotal",
				tax_total::text AS "taxTotal"
			FROM invoices
			WHERE tenant_id = $1
				AND total <> subtotal - discount_total + tax_total
			`,
			[tenantId],
		)) as Array<Record<string, string>>;
		for (const row of totals) {
			add(DiscrepancyCategory.INVOICE_TOTAL_MISMATCH, "invoice", row.id, row);
		}

		const dueTotals = (await manager.query(
			`
			SELECT id, amount_due::text AS "amountDue", total::text AS total,
				amount_paid::text AS "amountPaid",
				amount_credited::text AS "amountCredited"
			FROM invoices
			WHERE tenant_id = $1
				AND status IN ('open', 'partially_paid', 'paid', 'credited')
				AND amount_due <> GREATEST(total - amount_paid - amount_credited, 0)
			`,
			[tenantId],
		)) as Array<Record<string, string>>;
		for (const row of dueTotals) {
			add(DiscrepancyCategory.AMOUNT_DUE_MISMATCH, "invoice", row.id, row);
		}

		const lineCurrencies = (await manager.query(
			`
			SELECT l.id, l.currency AS "lineCurrency",
				i.currency AS "invoiceCurrency"
			FROM invoice_line_items l
			JOIN invoices i
				ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
			WHERE l.tenant_id = $1 AND l.currency <> i.currency
			`,
			[tenantId],
		)) as Array<Record<string, string>>;
		for (const row of lineCurrencies) {
			add(DiscrepancyCategory.CURRENCY_MISMATCH, "invoice_line", row.id, row);
		}

		const calculations = (await manager.query(
			`
			SELECT i.id, i.currency AS "invoiceCurrency",
				i.subtotal::text AS "invoiceSubtotal", i.total::text AS "invoiceTotal",
				c.currency AS "calculationCurrency",
				c.subtotal::text AS "calculationSubtotal",
				c.total::text AS "calculationTotal"
			FROM invoices i
			JOIN billing_calculations c
				ON c.tenant_id = i.tenant_id
				AND c.billing_period_id = i.billing_period_id
				AND c.status = 'completed'
			WHERE i.tenant_id = $1
				AND (
					c.currency <> i.currency OR c.subtotal <> i.subtotal OR
					c.total <> i.total
				)
			`,
			[tenantId],
		)) as Array<Record<string, string>>;
		for (const row of calculations) {
			add(
				DiscrepancyCategory.BILLING_CALCULATION_MISMATCH,
				"invoice",
				row.id,
				row,
			);
		}

		const duplicates = (await manager.query(
			`
			SELECT billing_period_id AS "billingPeriodId", COUNT(*)::int AS count
			FROM invoices
			WHERE tenant_id = $1 AND billing_period_id IS NOT NULL
			GROUP BY billing_period_id
			HAVING COUNT(*) > 1
			`,
			[tenantId],
		)) as Array<{ billingPeriodId: string; count: number }>;
		for (const row of duplicates) {
			add(
				DiscrepancyCategory.DUPLICATE_INVOICE,
				"billing_period",
				row.billingPeriodId,
				{ count: row.count },
			);
		}

		const missing = (await manager.query(
			`
			SELECT p.id
			FROM billing_periods p
			LEFT JOIN invoices i
				ON i.tenant_id = p.tenant_id AND i.billing_period_id = p.id
			WHERE p.tenant_id = $1 AND p.status = 'invoiced' AND i.id IS NULL
			`,
			[tenantId],
		)) as Array<{ id: string }>;
		for (const row of missing) {
			add(DiscrepancyCategory.MISSING_INVOICE, "billing_period", row.id, {});
		}

		const creditLines = (await manager.query(
			`
			SELECT c.id, c.amount::text AS amount,
				COALESCE(SUM(l.amount), 0)::text AS "lineTotal"
			FROM credit_notes c
			LEFT JOIN credit_note_lines l
				ON l.tenant_id = c.tenant_id AND l.credit_note_id = c.id
			WHERE c.tenant_id = $1
			GROUP BY c.id
			HAVING c.amount <> COALESCE(SUM(l.amount), 0)
			`,
			[tenantId],
		)) as Array<{ id: string; amount: string; lineTotal: string }>;
		for (const row of creditLines) {
			add(DiscrepancyCategory.CREDIT_TOTAL_MISMATCH, "credit_note", row.id, {
				amount: row.amount,
				lineTotal: row.lineTotal,
			});
		}

		const invoiceCredits = (await manager.query(
			`
			SELECT i.id, i.amount_credited::text AS "amountCredited",
				COALESCE(SUM(c.amount), 0)::text AS "creditTotal"
			FROM invoices i
			LEFT JOIN credit_notes c
				ON c.tenant_id = i.tenant_id AND c.invoice_id = i.id
				AND c.status = 'issued'
			WHERE i.tenant_id = $1
			GROUP BY i.id
			HAVING i.amount_credited <> COALESCE(SUM(c.amount), 0)
			`,
			[tenantId],
		)) as Array<Record<string, string>>;
		for (const row of invoiceCredits) {
			add(DiscrepancyCategory.CREDIT_TOTAL_MISMATCH, "invoice", row.id, row);
		}

		const meteredLines = (await manager.query(
			`
			SELECT l.id, l.amount::text AS amount, l.unit_price::text AS "unitPrice",
				l.metadata, i.currency,
				p.subscription_id AS "subscriptionId",
				p.period_start AS "periodStart", p.period_end AS "periodEnd"
			FROM invoice_line_items l
			JOIN invoices i
				ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
			LEFT JOIN billing_periods p
				ON p.tenant_id = i.tenant_id AND p.id = i.billing_period_id
			WHERE l.tenant_id = $1 AND l.line_type = 'metered'
			`,
			[tenantId],
		)) as MeteredLineRow[];
		for (const line of meteredLines) {
			const configuration = isRecord(line.metadata.configuration)
				? line.metadata.configuration
				: {};
			const metricId = configuration.metricId;
			const measuredRaw = line.metadata.measured;
			if (
				typeof metricId !== "string" ||
				typeof measuredRaw !== "string" ||
				line.subscriptionId === null ||
				line.periodStart === null ||
				line.periodEnd === null
			) {
				add(DiscrepancyCategory.USAGE_MISMATCH, "invoice_line", line.id, {
					reason: "MISSING_TRACEABILITY",
				});
				continue;
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
					line.subscriptionId,
					metricId,
					line.periodStart,
					line.periodEnd,
				],
			)) as Array<{ total: string }>;
			const measured = parseDecimal(measuredRaw) ?? 0n;
			const actual = parseDecimal(aggregateRows[0]?.total ?? "0") ?? 0n;
			if (measured !== actual) {
				add(DiscrepancyCategory.USAGE_MISMATCH, "invoice_line", line.id, {
					measured: formatDecimal(measured),
					aggregate: formatDecimal(actual),
				});
				continue;
			}
			const precision = currencyPrecision(line.currency);
			const unitPrice = parseDecimal(line.unitPrice);
			const included =
				configuration.includedUnits === undefined
					? 0n
					: (parseDecimal(String(configuration.includedUnits)) ?? 0n);
			const amount = parseDecimal(line.amount);
			if (precision !== null && unitPrice !== null && amount !== null) {
				const expected = multiplyAmount(
					maxAmount(measured - included, 0n),
					unitPrice,
					precision,
				);
				if (expected !== amount) {
					add(DiscrepancyCategory.USAGE_MISMATCH, "invoice_line", line.id, {
						expectedAmount: formatDecimal(expected),
						actualAmount: formatDecimal(amount),
					});
				}
			}
		}

		return output;
	}

	private toRunBody(run: BillingReconciliationRun): ReconciliationRunBody {
		return {
			id: run.id,
			status: run.status,
			requestedBy: run.requestedBy,
			invoicesChecked: run.invoicesChecked,
			discrepanciesFound: run.discrepanciesFound,
			errorCode: run.errorCode,
			startedAt: run.startedAt.toISOString(),
			completedAt:
				run.completedAt === null ? null : run.completedAt.toISOString(),
			createdAt: run.createdAt.toISOString(),
		};
	}

	private toDiscrepancyBody(
		row: BillingDiscrepancy | ReconciliationDiscrepancyRow,
	): DiscrepancyBody {
		return {
			id: row.id,
			reconciliationRunId: row.reconciliationRunId,
			category: row.category,
			resourceType: row.resourceType,
			resourceId: row.resourceId,
			details: row.details,
			status: row.status,
			resolutionNote: row.resolutionNote,
			resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
			createdAt: row.createdAt.toISOString(),
		};
	}
}

interface ReconciliationDiscrepancyRow {
	id: string;
	reconciliationRunId: string;
	category: DiscrepancyCategory;
	resourceType: string;
	resourceId: string | null;
	details: Record<string, unknown>;
	status: DiscrepancyStatus;
	resolutionNote: string | null;
	resolvedAt: Date | null;
	createdAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reconciliationErrorCode(error: unknown): string {
	if (error instanceof Error) {
		return error.name;
	}
	return "UNKNOWN";
}
