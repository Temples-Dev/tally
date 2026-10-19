import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager, Repository } from "typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { isUniqueViolation } from "../common/database-errors";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "../identity/audit.service";
import { ActorType } from "../identity/enums";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BackgroundJobsService } from "../jobs/background-jobs.service";
import { JobError } from "../jobs/job-handler";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import { normalizeQuantity } from "../usage/usage-payload";
import { QuotaPolicy } from "./entities/quota-policy.entity";
import { QuotaReservation } from "./entities/quota-reservation.entity";
import { QuotaUsageCounter } from "./entities/quota-usage-counter.entity";
import {
	QuotaEnforcementMode,
	QuotaOveragePolicy,
	QuotaReservationStatus,
	QuotaWindowType,
	isBlockingMode,
} from "./enums";
import { formatQuotaAmount, parseQuotaAmount } from "./quota-decimal";
import { type QuotaPeriod, resolveQuotaPeriod } from "./quota-period";
import type {
	CommitReservationDto,
	CreateQuotaPolicyDto,
	CreateReservationDto,
	UpdateQuotaPolicyDto,
} from "./quota.dto";

export const QUOTA_RESERVATION_EXPIRE_JOB = "quota.reservation.expire";

const DEFAULT_TTL_SECONDS = 900;

export interface QuotaAccounting {
	periodStart: string;
	periodEnd: string;
	used: string;
	reserved: string;
	remaining: string | null;
	overLimit: boolean;
	atLimit: boolean;
	status: "ok" | "at_limit" | "exceeded" | "unmetered";
}

export interface QuotaPolicyBody {
	id: string;
	key: string;
	metricId: string;
	metricName: string;
	unit: string;
	subscriptionId: string;
	limit: string | null;
	unmetered: boolean;
	windowType: QuotaWindowType;
	windowSize: number | null;
	enforcementMode: QuotaEnforcementMode;
	overagePolicy: QuotaOveragePolicy;
	effectiveFrom: string;
	effectiveUntil: string | null;
	accounting: QuotaAccounting | null;
}

export interface ReservationBody {
	id: string;
	operationId: string;
	key: string;
	metricId: string;
	subscriptionId: string;
	scopeKey: string;
	amount: string;
	committedQuantity: string;
	status: QuotaReservationStatus;
	exceeded: boolean;
	overrun: boolean;
	windowType: QuotaWindowType;
	expiresAt: string;
	committedAt: string | null;
	releasedAt: string | null;
	createdAt: string;
}

interface PolicyRow {
	id: string;
	tenantId: string;
	subscriptionId: string;
	metricId: string;
	limitValue: string | null;
	unmetered: boolean;
	windowType: QuotaWindowType;
	windowSize: number | null;
	enforcementMode: QuotaEnforcementMode;
	overagePolicy: QuotaOveragePolicy;
	effectiveFrom: Date;
	effectiveUntil: Date | null;
	createdAt: Date;
	updatedAt: Date;
	metricCode: string;
	metricName: string;
	unit: string;
	currentPeriodStart: Date | null;
	currentPeriodEnd: Date | null;
	startedAt: Date | null;
	subscriptionCreatedAt: Date;
}

interface ReservationRow {
	id: string;
	tenantId: string;
	subscriptionId: string;
	metricId: string;
	counterId: string;
	operationId: string;
	scopeKey: string;
	reservedQuantity: string;
	committedQuantity: string;
	status: QuotaReservationStatus;
	exceeded: boolean;
	overrun: boolean;
	windowType: QuotaWindowType;
	expiresAt: Date;
	committedAt: Date | null;
	releasedAt: Date | null;
	createdAt: Date;
}

interface CounterRow {
	id: string;
	usedValue: string;
	reservedValue: string;
}

interface ReconciliationRow {
	counterId: string;
	metricId: string;
	code: string;
	windowType: QuotaWindowType;
	periodStart: Date;
	periodEnd: Date;
	used: string;
	reserved: string;
	expectedUsed: string;
	expectedReserved: string;
}

@Injectable()
export class QuotasService {
	constructor(
		@InjectRepository(QuotaPolicy)
		private readonly policies: Repository<QuotaPolicy>,
		@InjectRepository(QuotaUsageCounter)
		private readonly counters: Repository<QuotaUsageCounter>,
		@InjectRepository(UsageMetric)
		private readonly metrics: Repository<UsageMetric>,
		@InjectRepository(Subscription)
		private readonly subscriptions: Repository<Subscription>,
		private readonly dataSource: DataSource,
		private readonly jobs: BackgroundJobsService,
		private readonly audit: AuditService,
	) {}

	async list(tenantId: string): Promise<QuotaPolicyBody[]> {
		const now = new Date();
		const rows = (await this.policies.query(
			`
			${POLICY_SELECT}
			WHERE p.tenant_id = $1
				AND p.effective_from <= $2
				AND (p.effective_until IS NULL OR p.effective_until > $2)
			ORDER BY m.code ASC
			`,
			[tenantId, now],
		)) as PolicyRow[];
		const result: QuotaPolicyBody[] = [];
		for (const row of rows) {
			result.push(await this.toPolicyBody(row, now));
		}
		return result;
	}

	async get(tenantId: string, key: string): Promise<QuotaPolicyBody> {
		const now = new Date();
		const row = await this.findPolicyRow(tenantId, key, now);
		if (row === null) {
			throw new NotFoundException("Quota policy not found.");
		}
		return this.toPolicyBody(row, now);
	}

	async create(
		tenantId: string,
		identityId: string,
		dto: CreateQuotaPolicyDto,
	): Promise<QuotaPolicyBody> {
		const metric = await this.metrics.findOneBy({
			tenantId,
			id: dto.metricId,
		});
		if (metric === null) {
			throw new NotFoundException("Usage metric not found.");
		}
		const subscription = await this.subscriptions.findOneBy({
			tenantId,
			id: dto.subscriptionId,
		});
		if (subscription === null) {
			throw new NotFoundException("Subscription not found.");
		}
		const unmetered = dto.unmetered ?? false;
		const limit = this.validateLimit(unmetered, dto.limitValue);
		const effectiveFrom =
			dto.effectiveFrom === undefined
				? new Date()
				: new Date(dto.effectiveFrom);
		const effectiveUntil =
			dto.effectiveUntil === undefined ? null : new Date(dto.effectiveUntil);
		this.validateEffectiveRange(effectiveFrom, effectiveUntil);
		const enforcementMode =
			dto.enforcementMode ??
			(dto.windowType === QuotaWindowType.CONCURRENT
				? QuotaEnforcementMode.CONCURRENT
				: QuotaEnforcementMode.HARD);
		const overagePolicy =
			dto.overagePolicy ??
			(isBlockingMode(enforcementMode)
				? QuotaOveragePolicy.DENY
				: QuotaOveragePolicy.ALLOW);

		const policy = this.policies.create({
			tenantId,
			subscriptionId: subscription.id,
			metricId: metric.id,
			limitValue: limit,
			unmetered,
			windowType: dto.windowType,
			windowSize: dto.windowSize ?? null,
			enforcementMode,
			overagePolicy,
			effectiveFrom,
			effectiveUntil,
		});
		try {
			await this.policies.save(policy);
		} catch (error: unknown) {
			if (isUniqueViolation(error)) {
				throw new ConflictException(
					"A quota policy already exists for this metric.",
				);
			}
			throw error;
		}
		await this.audit.record({
			tenantId,
			actorType: ActorType.HUMAN,
			actorId: identityId,
			action: "quota_policy.created",
			resourceType: "quota_policy",
			resourceId: policy.id,
			metadata: {
				metricId: metric.id,
				subscriptionId: subscription.id,
				windowType: policy.windowType,
				enforcementMode: policy.enforcementMode,
			},
		});
		const row = await this.findPolicyRow(tenantId, metric.code, new Date());
		if (row === null) {
			throw new NotFoundException("Quota policy not found.");
		}
		return this.toPolicyBody(row, new Date());
	}

	async update(
		tenantId: string,
		identityId: string,
		key: string,
		dto: UpdateQuotaPolicyDto,
	): Promise<QuotaPolicyBody> {
		const now = new Date();
		const existing = await this.findPolicyRow(tenantId, key, now, false);
		if (existing === null) {
			throw new NotFoundException("Quota policy not found.");
		}
		const policy = await this.policies.findOneBy({
			tenantId,
			id: existing.id,
		});
		if (policy === null) {
			throw new NotFoundException("Quota policy not found.");
		}
		const unmetered = dto.unmetered ?? policy.unmetered;
		const limit =
			dto.limitValue === undefined
				? unmetered
					? null
					: policy.limitValue
				: this.validateLimit(unmetered, dto.limitValue);
		if (!unmetered && limit === null) {
			throw new UnprocessableEntityException(
				"limitValue is required unless the quota is unmetered.",
			);
		}
		const effectiveFrom =
			dto.effectiveFrom === undefined
				? policy.effectiveFrom
				: new Date(dto.effectiveFrom);
		const effectiveUntil =
			dto.effectiveUntil === undefined
				? policy.effectiveUntil
				: new Date(dto.effectiveUntil);
		this.validateEffectiveRange(effectiveFrom, effectiveUntil);
		policy.limitValue = limit;
		policy.unmetered = unmetered;
		policy.windowType = dto.windowType ?? policy.windowType;
		policy.windowSize =
			dto.windowSize === undefined ? policy.windowSize : dto.windowSize;
		policy.enforcementMode = dto.enforcementMode ?? policy.enforcementMode;
		policy.overagePolicy = dto.overagePolicy ?? policy.overagePolicy;
		policy.effectiveFrom = effectiveFrom;
		policy.effectiveUntil = effectiveUntil;
		await this.policies.save(policy);
		await this.audit.record({
			tenantId,
			actorType: ActorType.HUMAN,
			actorId: identityId,
			action: "quota_policy.updated",
			resourceType: "quota_policy",
			resourceId: policy.id,
			metadata: {
				metricId: policy.metricId,
				windowType: policy.windowType,
				enforcementMode: policy.enforcementMode,
			},
		});
		const row = await this.findPolicyRow(tenantId, key, new Date());
		if (row === null) {
			throw new NotFoundException("Quota policy not found.");
		}
		return this.toPolicyBody(row, new Date());
	}

	async createReservation(
		tenantId: string,
		dto: CreateReservationDto,
	): Promise<ReservationBody> {
		const amount = parseQuotaAmount(dto.amount);
		if (amount === null || amount <= 0n) {
			throw new UnprocessableEntityException("amount must be positive.");
		}
		const expiresAt = this.resolveExpiry(dto);
		const now = new Date();

		return this.dataSource.transaction(async (manager) => {
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
				`quota:${tenantId}:${dto.operationId}`,
			]);
			const row = await this.findPolicyRow(
				tenantId,
				dto.key,
				now,
				true,
				manager,
			);
			if (row === null) {
				throw new NotFoundException("Quota policy is not configured.");
			}
			const existing = (await manager.query(
				`
				SELECT id, tenant_id AS "tenantId", subscription_id AS "subscriptionId",
					metric_id AS "metricId", counter_id AS "counterId",
					operation_id AS "operationId", scope_key AS "scopeKey",
					reserved_quantity AS "reservedQuantity",
					committed_quantity AS "committedQuantity", status, exceeded, overrun,
					window_type AS "windowType", expires_at AS "expiresAt",
					committed_at AS "committedAt", released_at AS "releasedAt",
					created_at AS "createdAt"
				FROM quota_reservations
				WHERE tenant_id = $1 AND operation_id = $2
				FOR UPDATE
				`,
				[tenantId, dto.operationId],
			)) as ReservationRow[];
			if (existing[0] !== undefined) {
				if (
					existing[0].metricId !== row.metricId ||
					parseQuotaAmount(existing[0].reservedQuantity) !== amount
				) {
					throw new ConflictException(
						"operationId was already used with different reservation parameters.",
					);
				}
				return this.toReservationBody(existing[0], row.metricCode);
			}

			const subscription = await manager
				.getRepository(Subscription)
				.findOneBy({ tenantId, id: row.subscriptionId });
			if (subscription === null) {
				throw new NotFoundException("Subscription not found.");
			}
			const period = resolveQuotaPeriod(
				row.windowType,
				row.windowSize,
				subscription,
				now,
			);
			await manager.query(
				`
				INSERT INTO quota_usage_counters (
					tenant_id, subscription_id, metric_id, period_start, period_end,
					used_value, reserved_value, counter_version
				)
				VALUES ($1, $2, $3, $4, $5, 0, 0, 1)
				ON CONFLICT (tenant_id, metric_id, period_start, period_end)
				DO NOTHING
				`,
				[tenantId, row.subscriptionId, row.metricId, period.start, period.end],
			);
			const counter = await this.lockCounter(
				manager,
				tenantId,
				row.metricId,
				period.start,
				period.end,
			);
			const used = parseQuotaAmount(counter.usedValue) ?? 0n;
			const reserved = parseQuotaAmount(counter.reservedValue) ?? 0n;
			const limit =
				row.limitValue === null ? null : parseQuotaAmount(row.limitValue);
			const projected = used + reserved + amount;
			const overLimit = limit !== null && projected > limit;
			if (overLimit && isBlockingMode(row.enforcementMode)) {
				throw new ConflictException(
					`Quota ${row.metricCode} exceeded. Used ${formatQuotaAmount(
						used,
					)}, reserved ${formatQuotaAmount(reserved)}, limit ${formatQuotaAmount(
						limit ?? 0n,
					)}.`,
				);
			}

			await manager.query(
				`
				UPDATE quota_usage_counters
				SET reserved_value = reserved_value + $2::numeric,
					counter_version = counter_version + 1,
					updated_at = now()
				WHERE id = $1
				`,
				[counter.id, formatQuotaAmount(amount)],
			);
			const inserted = (await manager.query(
				`
				INSERT INTO quota_reservations (
					tenant_id, subscription_id, metric_id, counter_id, operation_id,
					scope_key, window_type, reserved_quantity, committed_quantity,
					status, exceeded, overrun, expires_at
				)
				VALUES ($1, $2, $3, $4, $5, 'tenant', $6, $7, 0, 'reserved', $8, false, $9)
				RETURNING id, tenant_id AS "tenantId", subscription_id AS "subscriptionId",
					metric_id AS "metricId", counter_id AS "counterId",
					operation_id AS "operationId", scope_key AS "scopeKey",
					reserved_quantity AS "reservedQuantity",
					committed_quantity AS "committedQuantity", status, exceeded, overrun,
					window_type AS "windowType", expires_at AS "expiresAt",
					committed_at AS "committedAt", released_at AS "releasedAt",
					created_at AS "createdAt"
				`,
				[
					tenantId,
					row.subscriptionId,
					row.metricId,
					counter.id,
					dto.operationId,
					row.windowType,
					formatQuotaAmount(amount),
					overLimit,
					expiresAt,
				],
			)) as ReservationRow[];
			const reservation = inserted[0];
			if (reservation === undefined) {
				throw new Error("The reservation could not be created.");
			}
			await this.jobs.enqueue(
				{
					tenantId,
					jobType: QUOTA_RESERVATION_EXPIRE_JOB,
					idempotencyKey: `quota.reservation.expire:${reservation.id}`,
					payload: { reservationId: reservation.id },
					availableAt: expiresAt,
					maxAttempts: 3,
				},
				manager,
			);
			return this.toReservationBody(reservation, row.metricCode);
		});
	}

	async getReservation(
		tenantId: string,
		reservationId: string,
	): Promise<ReservationBody> {
		const result = (await this.dataSource.query(
			`
			${RESERVATION_SELECT}
			WHERE r.tenant_id = $1 AND r.id = $2
			`,
			[tenantId, reservationId],
		)) as Array<ReservationRow & { metricCode: string }>;
		const row = result[0];
		if (row === undefined) {
			throw new NotFoundException("Quota reservation not found.");
		}
		return this.toReservationBody(row, row.metricCode);
	}

	async commitReservation(
		tenantId: string,
		reservationId: string,
		dto: CommitReservationDto,
	): Promise<ReservationBody> {
		return this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`
				SELECT r.id, r.tenant_id AS "tenantId", r.subscription_id AS "subscriptionId",
					r.metric_id AS "metricId", r.counter_id AS "counterId",
					r.operation_id AS "operationId", r.scope_key AS "scopeKey",
					r.reserved_quantity AS "reservedQuantity",
					r.committed_quantity AS "committedQuantity", r.status, r.exceeded, r.overrun,
					r.window_type AS "windowType", r.expires_at AS "expiresAt",
					r.committed_at AS "committedAt", r.released_at AS "releasedAt",
					r.created_at AS "createdAt", m.code AS "metricCode"
				FROM quota_reservations r
				JOIN usage_metrics m
					ON m.tenant_id = r.tenant_id AND m.id = r.metric_id
				WHERE r.tenant_id = $1 AND r.id = $2
				FOR UPDATE OF r
				`,
				[tenantId, reservationId],
			)) as Array<ReservationRow & { metricCode: string }>;
			const reservation = rows[0];
			if (reservation === undefined) {
				throw new NotFoundException("Quota reservation not found.");
			}
			if (reservation.status === QuotaReservationStatus.COMMITTED) {
				if (
					dto.amount !== undefined &&
					normalizeQuantity(dto.amount) !==
						normalizeQuantity(reservation.committedQuantity)
				) {
					throw new ConflictException(
						"The reservation was already committed with a different amount.",
					);
				}
				return this.toReservationBody(reservation, reservation.metricCode);
			}
			if (reservation.status !== QuotaReservationStatus.RESERVED) {
				throw new ConflictException(
					`The reservation is already ${reservation.status}.`,
				);
			}
			const actual =
				dto.amount === undefined
					? (parseQuotaAmount(reservation.reservedQuantity) ?? 0n)
					: parseQuotaAmount(dto.amount);
			if (actual === null) {
				throw new UnprocessableEntityException("amount is invalid.");
			}
			const reserved = parseQuotaAmount(reservation.reservedQuantity) ?? 0n;
			const counter = await this.lockCounterById(
				manager,
				reservation.counterId,
			);
			const usedIncrement =
				reservation.windowType === QuotaWindowType.CONCURRENT ? 0n : actual;
			await manager.query(
				`
				UPDATE quota_usage_counters
				SET reserved_value = GREATEST(0, reserved_value - $2::numeric),
					used_value = used_value + $3::numeric,
					counter_version = counter_version + 1,
					updated_at = now()
				WHERE id = $1
				`,
				[
					counter.id,
					formatQuotaAmount(reserved),
					formatQuotaAmount(usedIncrement),
				],
			);
			const updated = returnedRows<ReservationRow>(
				await manager.query(
					`
				UPDATE quota_reservations
				SET status = 'committed',
					committed_quantity = $2,
					committed_at = now(),
					overrun = $3,
					updated_at = now()
				WHERE id = $1
				RETURNING id, tenant_id AS "tenantId", subscription_id AS "subscriptionId",
					metric_id AS "metricId", counter_id AS "counterId",
					operation_id AS "operationId", scope_key AS "scopeKey",
					reserved_quantity AS "reservedQuantity",
					committed_quantity AS "committedQuantity", status, exceeded, overrun,
					window_type AS "windowType", expires_at AS "expiresAt",
					committed_at AS "committedAt", released_at AS "releasedAt",
					created_at AS "createdAt"
				`,
					[reservation.id, formatQuotaAmount(actual), actual > reserved],
				),
			);
			const row = updated[0];
			if (row === undefined) {
				throw new Error("The reservation could not be committed.");
			}
			return this.toReservationBody(row, reservation.metricCode);
		});
	}

	async releaseReservation(
		tenantId: string,
		reservationId: string,
	): Promise<ReservationBody> {
		return this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`
				SELECT r.id, r.tenant_id AS "tenantId", r.subscription_id AS "subscriptionId",
					r.metric_id AS "metricId", r.counter_id AS "counterId",
					r.operation_id AS "operationId", r.scope_key AS "scopeKey",
					r.reserved_quantity AS "reservedQuantity",
					r.committed_quantity AS "committedQuantity", r.status, r.exceeded, r.overrun,
					r.window_type AS "windowType", r.expires_at AS "expiresAt",
					r.committed_at AS "committedAt", r.released_at AS "releasedAt",
					r.created_at AS "createdAt", m.code AS "metricCode"
				FROM quota_reservations r
				JOIN usage_metrics m
					ON m.tenant_id = r.tenant_id AND m.id = r.metric_id
				WHERE r.tenant_id = $1 AND r.id = $2
				FOR UPDATE OF r
				`,
				[tenantId, reservationId],
			)) as Array<ReservationRow & { metricCode: string }>;
			const reservation = rows[0];
			if (reservation === undefined) {
				throw new NotFoundException("Quota reservation not found.");
			}
			if (reservation.status === QuotaReservationStatus.RELEASED) {
				return this.toReservationBody(reservation, reservation.metricCode);
			}
			if (reservation.status !== QuotaReservationStatus.RESERVED) {
				throw new ConflictException(
					`The reservation is already ${reservation.status}.`,
				);
			}
			await this.releaseReservedCapacity(manager, reservation);
			await manager.query(
				`
				UPDATE quota_reservations
				SET status = 'released', released_at = now(), updated_at = now()
				WHERE id = $1
				`,
				[reservation.id],
			);
			const updated = await this.fetchReservation(
				manager,
				tenantId,
				reservationId,
			);
			return this.toReservationBody(updated, reservation.metricCode);
		});
	}

	async expireReservation(reservationId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`
				SELECT r.id, r.tenant_id AS "tenantId", r.subscription_id AS "subscriptionId",
					r.metric_id AS "metricId", r.counter_id AS "counterId",
					r.operation_id AS "operationId", r.scope_key AS "scopeKey",
					r.reserved_quantity AS "reservedQuantity",
					r.committed_quantity AS "committedQuantity", r.status, r.exceeded, r.overrun,
					r.window_type AS "windowType", r.expires_at AS "expiresAt",
					r.committed_at AS "committedAt", r.released_at AS "releasedAt",
					r.created_at AS "createdAt"
				FROM quota_reservations r
				WHERE r.id = $1
				FOR UPDATE
				`,
				[reservationId],
			)) as ReservationRow[];
			const reservation = rows[0];
			if (
				reservation === undefined ||
				reservation.status !== QuotaReservationStatus.RESERVED
			) {
				return;
			}
			if (reservation.expiresAt.getTime() > Date.now()) {
				throw new JobError("The reservation has not expired yet.", "NOT_DUE");
			}
			await this.releaseReservedCapacity(manager, reservation);
			await manager.query(
				`
				UPDATE quota_reservations
				SET status = 'expired', released_at = now(), updated_at = now()
				WHERE id = $1
				`,
				[reservation.id],
			);
		});
	}

	async reconciliation(tenantId: string): Promise<{
		checkedAt: string;
		counters: number;
		matches: boolean;
		discrepancies: Array<{
			counterId: string;
			metricId: string;
			key: string;
			windowType: QuotaWindowType;
			periodStart: string;
			periodEnd: string;
			used: string;
			reserved: string;
			expectedUsed: string;
			expectedReserved: string;
		}>;
	}> {
		const rows = (await this.dataSource.query(
			`
			SELECT c.id AS "counterId", c.metric_id AS "metricId", m.code,
				p.window_type AS "windowType", c.period_start AS "periodStart",
				c.period_end AS "periodEnd", c.used_value AS used,
				c.reserved_value AS reserved,
				COALESCE(SUM(r.committed_quantity) FILTER (
					WHERE r.status = 'committed'
				), 0) AS "expectedUsed",
				COALESCE(SUM(r.reserved_quantity) FILTER (
					WHERE r.status = 'reserved' AND r.expires_at > now()
				), 0) AS "expectedReserved"
			FROM quota_usage_counters c
			JOIN usage_metrics m
				ON m.tenant_id = c.tenant_id AND m.id = c.metric_id
			JOIN quota_policies p
				ON p.tenant_id = c.tenant_id AND p.metric_id = c.metric_id
			LEFT JOIN quota_reservations r ON r.counter_id = c.id
			WHERE c.tenant_id = $1
			GROUP BY c.id, c.metric_id, m.code, p.window_type,
				c.period_start, c.period_end, c.used_value, c.reserved_value
			ORDER BY c.period_start ASC
			`,
			[tenantId],
		)) as ReconciliationRow[];
		const discrepancies = rows
			.filter((row) => {
				const usedMatches =
					row.windowType === QuotaWindowType.CONCURRENT ||
					(parseQuotaAmount(row.used) ?? 0n) ===
						(parseQuotaAmount(row.expectedUsed) ?? 0n);
				const reservedMatches =
					(parseQuotaAmount(row.reserved) ?? 0n) ===
					(parseQuotaAmount(row.expectedReserved) ?? 0n);
				return !usedMatches || !reservedMatches;
			})
			.map((row) => ({
				counterId: row.counterId,
				metricId: row.metricId,
				key: row.code,
				windowType: row.windowType,
				periodStart: row.periodStart.toISOString(),
				periodEnd: row.periodEnd.toISOString(),
				used: normalizeQuantity(row.used) ?? row.used,
				reserved: normalizeQuantity(row.reserved) ?? row.reserved,
				expectedUsed: normalizeQuantity(row.expectedUsed) ?? row.expectedUsed,
				expectedReserved:
					normalizeQuantity(row.expectedReserved) ?? row.expectedReserved,
			}));
		return {
			checkedAt: new Date().toISOString(),
			counters: rows.length,
			matches: discrepancies.length === 0,
			discrepancies,
		};
	}

	private async releaseReservedCapacity(
		manager: EntityManager,
		reservation: ReservationRow,
	): Promise<void> {
		const reserved = parseQuotaAmount(reservation.reservedQuantity) ?? 0n;
		await manager.query(
			`
			UPDATE quota_usage_counters
			SET reserved_value = GREATEST(0, reserved_value - $2::numeric),
				counter_version = counter_version + 1,
				updated_at = now()
			WHERE id = $1
			`,
			[reservation.counterId, formatQuotaAmount(reserved)],
		);
	}

	private async fetchReservation(
		manager: EntityManager,
		tenantId: string,
		reservationId: string,
	): Promise<ReservationRow> {
		const rows = (await manager.query(
			`
			SELECT id, tenant_id AS "tenantId", subscription_id AS "subscriptionId",
				metric_id AS "metricId", counter_id AS "counterId",
				operation_id AS "operationId", scope_key AS "scopeKey",
				reserved_quantity AS "reservedQuantity",
				committed_quantity AS "committedQuantity", status, exceeded, overrun,
				window_type AS "windowType", expires_at AS "expiresAt",
				committed_at AS "committedAt", released_at AS "releasedAt",
				created_at AS "createdAt"
			FROM quota_reservations
			WHERE tenant_id = $1 AND id = $2
			`,
			[tenantId, reservationId],
		)) as ReservationRow[];
		const row = rows[0];
		if (row === undefined) {
			throw new NotFoundException("Quota reservation not found.");
		}
		return row;
	}

	private async lockCounter(
		manager: EntityManager,
		tenantId: string,
		metricId: string,
		periodStart: Date,
		periodEnd: Date,
	): Promise<CounterRow> {
		const rows = (await manager.query(
			`
			SELECT id, used_value AS "usedValue", reserved_value AS "reservedValue"
			FROM quota_usage_counters
			WHERE tenant_id = $1 AND metric_id = $2
				AND period_start = $3 AND period_end = $4
			FOR UPDATE
			`,
			[tenantId, metricId, periodStart, periodEnd],
		)) as CounterRow[];
		const row = rows[0];
		if (row === undefined) {
			throw new Error("The quota counter could not be locked.");
		}
		return row;
	}

	private async lockCounterById(
		manager: EntityManager,
		counterId: string,
	): Promise<CounterRow> {
		const rows = (await manager.query(
			`
			SELECT id, used_value AS "usedValue", reserved_value AS "reservedValue"
			FROM quota_usage_counters
			WHERE id = $1
			FOR UPDATE
			`,
			[counterId],
		)) as CounterRow[];
		const row = rows[0];
		if (row === undefined) {
			throw new Error("The quota counter could not be locked.");
		}
		return row;
	}

	private async findPolicyRow(
		tenantId: string,
		key: string,
		now: Date,
		lock = false,
		manager?: EntityManager,
	): Promise<PolicyRow | null> {
		const runner = manager ?? this.dataSource;
		const rows = (await runner.query(
			`
			${POLICY_SELECT}
			WHERE p.tenant_id = $1 AND m.code = $2
				AND p.effective_from <= $3
				AND (p.effective_until IS NULL OR p.effective_until > $3)
			ORDER BY p.effective_from DESC
			LIMIT 1
			${lock ? "FOR UPDATE OF p" : ""}
			`,
			[tenantId, key, now],
		)) as PolicyRow[];
		return rows[0] ?? null;
	}

	private async toPolicyBody(
		row: PolicyRow,
		now: Date,
	): Promise<QuotaPolicyBody> {
		const subscription = {
			startedAt: row.startedAt,
			createdAt: row.subscriptionCreatedAt,
			currentPeriodStart: row.currentPeriodStart,
			currentPeriodEnd: row.currentPeriodEnd,
		};
		let accounting: QuotaAccounting | null = null;
		try {
			const period = resolveQuotaPeriod(
				row.windowType,
				row.windowSize,
				subscription,
				now,
			);
			const counter = await this.counters.findOneBy({
				tenantId: row.tenantId,
				metricId: row.metricId,
				periodStart: period.start,
				periodEnd: period.end,
			});
			accounting = this.toAccounting(
				row,
				period,
				counter?.usedValue ?? "0",
				counter?.reservedValue ?? "0",
			);
		} catch (error: unknown) {
			if (!(error instanceof UnprocessableEntityException)) {
				throw error;
			}
		}
		return {
			id: row.id,
			key: row.metricCode,
			metricId: row.metricId,
			metricName: row.metricName,
			unit: row.unit,
			subscriptionId: row.subscriptionId,
			limit:
				row.limitValue === null
					? null
					: (normalizeQuantity(row.limitValue) ?? row.limitValue),
			unmetered: row.unmetered,
			windowType: row.windowType,
			windowSize: row.windowSize,
			enforcementMode: row.enforcementMode,
			overagePolicy: row.overagePolicy,
			effectiveFrom: row.effectiveFrom.toISOString(),
			effectiveUntil:
				row.effectiveUntil === null ? null : row.effectiveUntil.toISOString(),
			accounting,
		};
	}

	private toAccounting(
		row: PolicyRow,
		period: QuotaPeriod,
		usedRaw: string,
		reservedRaw: string,
	): QuotaAccounting {
		const used = parseQuotaAmount(usedRaw) ?? 0n;
		const reserved = parseQuotaAmount(reservedRaw) ?? 0n;
		const consumed = used + reserved;
		const limit =
			row.limitValue === null ? null : parseQuotaAmount(row.limitValue);
		const overLimit =
			row.unmetered || limit === null ? false : consumed > limit;
		const atLimit =
			row.unmetered || limit === null ? false : consumed === limit;
		const remaining =
			row.unmetered || limit === null
				? null
				: formatQuotaAmount(limit > consumed ? limit - consumed : 0n);
		const status = row.unmetered
			? "unmetered"
			: overLimit
				? "exceeded"
				: atLimit
					? "at_limit"
					: "ok";
		return {
			periodStart: period.start.toISOString(),
			periodEnd: period.end.toISOString(),
			used: formatQuotaAmount(used),
			reserved: formatQuotaAmount(reserved),
			remaining,
			overLimit,
			atLimit,
			status,
		};
	}

	private toReservationBody(
		row: ReservationRow,
		metricCode: string,
	): ReservationBody {
		return {
			id: row.id,
			operationId: row.operationId,
			key: metricCode,
			metricId: row.metricId,
			subscriptionId: row.subscriptionId,
			scopeKey: row.scopeKey,
			amount: normalizeQuantity(row.reservedQuantity) ?? row.reservedQuantity,
			committedQuantity:
				normalizeQuantity(row.committedQuantity) ?? row.committedQuantity,
			status: row.status,
			exceeded: row.exceeded,
			overrun: row.overrun,
			windowType: row.windowType,
			expiresAt: row.expiresAt.toISOString(),
			committedAt:
				row.committedAt === null ? null : row.committedAt.toISOString(),
			releasedAt: row.releasedAt === null ? null : row.releasedAt.toISOString(),
			createdAt: row.createdAt.toISOString(),
		};
	}

	private validateLimit(
		unmetered: boolean,
		raw: string | undefined,
	): string | null {
		if (unmetered) {
			if (raw !== undefined) {
				throw new UnprocessableEntityException(
					"limitValue must be omitted when the quota is unmetered.",
				);
			}
			return null;
		}
		if (raw === undefined) {
			throw new UnprocessableEntityException(
				"limitValue is required unless the quota is unmetered.",
			);
		}
		if (parseQuotaAmount(raw) === null) {
			throw new UnprocessableEntityException("limitValue is invalid.");
		}
		return raw;
	}

	private validateEffectiveRange(
		effectiveFrom: Date,
		effectiveUntil: Date | null,
	): void {
		if (
			Number.isNaN(effectiveFrom.getTime()) ||
			(effectiveUntil !== null &&
				(Number.isNaN(effectiveUntil.getTime()) ||
					effectiveUntil.getTime() <= effectiveFrom.getTime()))
		) {
			throw new UnprocessableEntityException(
				"effectiveUntil must be later than effectiveFrom.",
			);
		}
	}

	private resolveExpiry(dto: CreateReservationDto): Date {
		if (dto.expiresAt !== undefined) {
			const expiresAt = new Date(dto.expiresAt);
			if (expiresAt.getTime() <= Date.now()) {
				throw new UnprocessableEntityException(
					"expiresAt must be in the future.",
				);
			}
			return expiresAt;
		}
		return new Date(
			Date.now() + (dto.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
		);
	}
}

function returnedRows<T>(result: unknown): T[] {
	if (Array.isArray(result) && Array.isArray(result[0])) {
		return result[0] as T[];
	}
	return (result as T[]) ?? [];
}

const POLICY_SELECT = `
	SELECT p.id, p.tenant_id AS "tenantId",
		p.subscription_id AS "subscriptionId", p.metric_id AS "metricId",
		p.limit_value AS "limitValue", p.unmetered,
		p.window_type AS "windowType", p.window_size AS "windowSize",
		p.enforcement_mode AS "enforcementMode",
		p.overage_policy AS "overagePolicy",
		p.effective_from AS "effectiveFrom",
		p.effective_until AS "effectiveUntil",
		p.created_at AS "createdAt", p.updated_at AS "updatedAt",
		m.code AS "metricCode", m.name AS "metricName", m.unit,
		s.current_period_start AS "currentPeriodStart",
		s.current_period_end AS "currentPeriodEnd",
		s.started_at AS "startedAt", s.created_at AS "subscriptionCreatedAt"
	FROM quota_policies p
	JOIN usage_metrics m
		ON m.tenant_id = p.tenant_id AND m.id = p.metric_id
	JOIN subscriptions s
		ON s.tenant_id = p.tenant_id AND s.id = p.subscription_id
`;

const RESERVATION_SELECT = `
	SELECT r.id, r.tenant_id AS "tenantId", r.subscription_id AS "subscriptionId",
		r.metric_id AS "metricId", r.counter_id AS "counterId",
		r.operation_id AS "operationId", r.scope_key AS "scopeKey",
		r.reserved_quantity AS "reservedQuantity",
		r.committed_quantity AS "committedQuantity", r.status, r.exceeded, r.overrun,
		r.window_type AS "windowType", r.expires_at AS "expiresAt",
		r.committed_at AS "committedAt", r.released_at AS "releasedAt",
		r.created_at AS "createdAt", m.code AS "metricCode"
	FROM quota_reservations r
	JOIN usage_metrics m
		ON m.tenant_id = r.tenant_id AND m.id = r.metric_id
`;
