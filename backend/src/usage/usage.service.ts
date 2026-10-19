import {
	ConflictException,
	HttpException,
	Injectable,
	Logger,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { Repository, SelectQueryBuilder } from "typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { AggregationMethod, MeterStatus } from "../catalog/enums";
import { isUniqueViolation } from "../common/database-errors";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { BackgroundJobsService } from "../jobs/background-jobs.service";
import { CustomerAccount } from "../subscriptions/entities/customer-account.entity";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import {
	USAGE_AGGREGATION_JOB,
	utcDayBounds,
} from "./aggregation/usage-aggregation.types";
import { UsageAggregate } from "./entities/usage-aggregate.entity";
import { UsageEvent } from "./entities/usage-event.entity";
import { UsageEventStatus } from "./enums";
import {
	hashUsagePayload,
	isNegativeQuantity,
	normalizeQuantity,
	validateDimensions,
} from "./usage-payload";
import {
	IngestUsageEventDto,
	type ListUsageEventsQueryDto,
	type UsageSummaryQueryDto,
} from "./usage.dto";

export interface IngestOutcome {
	status: "accepted" | "duplicate";
	event: UsageEvent;
}

export interface BatchEventResult {
	index: number;
	externalEventId: string | null;
	status: "accepted" | "duplicate" | "rejected";
	eventId?: string;
	reason?: string;
}

export interface UsageEventBody {
	id: string;
	externalEventId: string;
	source: string;
	customerAccountId: string;
	subscriptionId: string | null;
	metricId: string;
	quantity: string;
	dimensions: Record<string, unknown>;
	occurredAt: string;
	receivedAt: string;
	status: UsageEventStatus;
}

export interface UsageSummaryBody {
	metric: {
		id: string;
		code: string;
		name: string;
		unit: string;
		aggregationMethod: AggregationMethod;
	};
	from: string;
	to: string;
	total: string | null;
	eventCount: number;
	aggregates: Array<{
		id: string;
		customerAccountId: string;
		subscriptionId: string | null;
		periodStart: string;
		periodEnd: string;
		dimensions: Record<string, unknown>;
		value: string;
		eventCount: number;
		revision: number;
		calculatedAt: string;
	}>;
	freshness: { lastCalculatedAt: string | null };
}

@Injectable()
export class UsageService {
	private readonly logger = new Logger(UsageService.name);

	constructor(
		@InjectRepository(UsageEvent)
		private readonly events: Repository<UsageEvent>,
		@InjectRepository(UsageMetric)
		private readonly metrics: Repository<UsageMetric>,
		@InjectRepository(CustomerAccount)
		private readonly customers: Repository<CustomerAccount>,
		@InjectRepository(Subscription)
		private readonly subscriptions: Repository<Subscription>,
		@InjectRepository(UsageAggregate)
		private readonly aggregates: Repository<UsageAggregate>,
		private readonly jobs: BackgroundJobsService,
		private readonly dataSource: DataSource,
	) {}

	async ingest(
		tenantId: string,
		dto: IngestUsageEventDto,
	): Promise<IngestOutcome> {
		const quantity = normalizeQuantity(dto.quantity);
		if (quantity === null) {
			throw new UnprocessableEntityException(
				"quantity is outside the supported decimal range.",
			);
		}
		const occurredAt = new Date(dto.occurredAt);
		if (Number.isNaN(occurredAt.getTime())) {
			throw new UnprocessableEntityException("occurredAt is invalid.");
		}

		const [metric, customer, subscription] = await Promise.all([
			this.metrics.findOneBy({ tenantId, id: dto.metricId }),
			this.customers.findOneBy({ tenantId, id: dto.customerAccountId }),
			dto.subscriptionId === undefined
				? Promise.resolve(null)
				: this.subscriptions.findOneBy({
						tenantId,
						id: dto.subscriptionId,
					}),
		]);
		if (metric === null || metric.status !== MeterStatus.ACTIVE) {
			throw new NotFoundException("Usage metric not found.");
		}
		if (customer === null) {
			throw new NotFoundException("Customer account not found.");
		}
		if (dto.subscriptionId !== undefined) {
			if (
				subscription === null ||
				subscription.customerAccountId !== customer.id
			) {
				throw new UnprocessableEntityException(
					"The subscription does not belong to the customer.",
				);
			}
		}

		const dimensions = dto.dimensions ?? {};
		const dimensionsProblem = validateDimensions(
			dimensions,
			metric.allowedDimensions,
		);
		if (dimensionsProblem !== null) {
			throw new UnprocessableEntityException(dimensionsProblem);
		}

		const now = new Date();
		if (
			occurredAt.getTime() >
			now.getTime() + metric.maxFutureSkewSeconds * 1000
		) {
			throw new UnprocessableEntityException(
				"occurredAt is too far in the future.",
			);
		}
		if (
			metric.maxEventAgeSeconds !== null &&
			occurredAt.getTime() < now.getTime() - metric.maxEventAgeSeconds * 1000
		) {
			throw new UnprocessableEntityException(
				"occurredAt is older than the metric's accepted window.",
			);
		}
		if (isNegativeQuantity(quantity) && !metric.allowsNegative) {
			throw new UnprocessableEntityException(
				"This metric does not allow negative quantities.",
			);
		}

		const payloadHash = hashUsagePayload({
			customerAccountId: customer.id,
			subscriptionId: subscription?.id ?? null,
			metricId: metric.id,
			quantity,
			occurredAt,
			dimensions,
		});

		const period = utcDayBounds(occurredAt);
		try {
			const event = await this.dataSource.transaction(async (manager) => {
				const repository = manager.getRepository(UsageEvent);
				const saved = await repository.save(
					repository.create({
						tenantId,
						source: dto.source,
						externalEventId: dto.externalEventId,
						customerAccountId: customer.id,
						subscriptionId: subscription?.id ?? null,
						metricId: metric.id,
						quantity,
						dimensions,
						occurredAt,
						receivedAt: now,
						payloadHash,
						status: UsageEventStatus.ACCEPTED,
					}),
				);
				await this.jobs.enqueue(
					{
						tenantId,
						jobType: USAGE_AGGREGATION_JOB,
						idempotencyKey: `usage.aggregate:${saved.id}`,
						payload: {
							tenantId,
							customerAccountId: customer.id,
							subscriptionId: subscription?.id ?? null,
							metricId: metric.id,
							periodStart: period.start.toISOString(),
							periodEnd: period.end.toISOString(),
							dimensions,
						},
					},
					manager,
				);
				return saved;
			});
			return { status: "accepted", event };
		} catch (error) {
			if (!isUniqueViolation(error)) {
				throw error;
			}
			const existing = await this.events.findOneBy({
				tenantId,
				source: dto.source,
				externalEventId: dto.externalEventId,
			});
			if (existing === null) {
				throw error;
			}
			if (existing.payloadHash !== payloadHash) {
				throw new ConflictException(
					"This externalEventId was already accepted with a different payload.",
				);
			}
			return { status: "duplicate", event: existing };
		}
	}

	async ingestBatch(
		tenantId: string,
		rawEvents: unknown[],
	): Promise<BatchEventResult[]> {
		const results: BatchEventResult[] = [];
		for (let index = 0; index < rawEvents.length; index += 1) {
			const raw = rawEvents[index];
			const dto = plainToInstance(IngestUsageEventDto, raw);
			const errors = await validate(dto, {
				whitelist: true,
				forbidNonWhitelisted: true,
				forbidUnknownValues: false,
			});
			if (errors.length > 0) {
				results.push({
					index,
					externalEventId:
						typeof (raw as { externalEventId?: unknown })?.externalEventId ===
						"string"
							? (raw as { externalEventId: string }).externalEventId
							: null,
					status: "rejected",
					reason: this.firstMessage(errors),
				});
				continue;
			}
			try {
				const outcome = await this.ingest(tenantId, dto);
				results.push({
					index,
					externalEventId: dto.externalEventId,
					status: outcome.status,
					eventId: outcome.event.id,
				});
			} catch (error) {
				if (!(error instanceof HttpException)) {
					this.logger.error(
						`Batch usage ingestion failed at index ${index}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
				results.push({
					index,
					externalEventId: dto.externalEventId,
					status: "rejected",
					reason:
						error instanceof HttpException
							? error.message
							: "The event could not be recorded.",
				});
			}
		}
		return results;
	}

	async getEvent(tenantId: string, id: string): Promise<UsageEventBody> {
		const event = await this.events.findOneBy({ tenantId, id });
		if (event === null) {
			throw new NotFoundException("Usage event not found.");
		}
		return this.toBody(event);
	}

	async listEvents(
		tenantId: string,
		query: ListUsageEventsQueryDto,
	): Promise<{
		data: UsageEventBody[];
		pagination: { nextCursor: string | null; hasMore: boolean };
	}> {
		const limit = query.limit ?? 50;
		const from = query.from === undefined ? null : new Date(query.from);
		const to = query.to === undefined ? null : new Date(query.to);
		if (from !== null && to !== null && from.getTime() >= to.getTime()) {
			throw new UnprocessableEntityException("from must be earlier than to.");
		}

		const builder = this.events
			.createQueryBuilder("event")
			.where("event.tenant_id = :tenantId", { tenantId })
			.orderBy("event.occurred_at", "DESC")
			.addOrderBy("event.id", "DESC")
			.take(limit + 1);

		if (query.metricId !== undefined) {
			builder.andWhere("event.metric_id = :metricId", {
				metricId: query.metricId,
			});
		}
		if (query.customerAccountId !== undefined) {
			builder.andWhere("event.customer_account_id = :customerAccountId", {
				customerAccountId: query.customerAccountId,
			});
		}
		if (query.subscriptionId !== undefined) {
			builder.andWhere("event.subscription_id = :subscriptionId", {
				subscriptionId: query.subscriptionId,
			});
		}
		if (from !== null) {
			builder.andWhere("event.occurred_at >= :from", { from });
		}
		if (to !== null) {
			builder.andWhere("event.occurred_at < :to", { to });
		}
		if (query.cursor !== undefined) {
			const cursor = this.decodeCursor(query.cursor);
			builder.andWhere(
				"(event.occurred_at, event.id) < (:cursorAt, :cursorId)",
				{
					cursorAt: cursor.occurredAt,
					cursorId: cursor.id,
				},
			);
		}

		const rows = await builder.getMany();
		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const last = page[page.length - 1];
		return {
			data: page.map((event) => this.toBody(event)),
			pagination: {
				hasMore,
				nextCursor:
					hasMore && last !== undefined ? this.encodeCursor(last) : null,
			},
		};
	}

	async summary(
		tenantId: string,
		query: UsageSummaryQueryDto,
	): Promise<UsageSummaryBody> {
		const from = new Date(query.from);
		const to = new Date(query.to);
		const dayMs = 86_400_000;
		if (from.getTime() >= to.getTime()) {
			throw new UnprocessableEntityException("from must be earlier than to.");
		}
		if (from.getTime() % dayMs !== 0 || to.getTime() % dayMs !== 0) {
			throw new UnprocessableEntityException(
				"from and to must be UTC day boundaries.",
			);
		}
		if (to.getTime() - from.getTime() > 366 * dayMs) {
			throw new UnprocessableEntityException(
				"The summary range must not exceed 366 days.",
			);
		}

		const metric = await this.metrics.findOneBy({
			tenantId,
			id: query.metricId,
		});
		if (metric === null) {
			throw new NotFoundException("Usage metric not found.");
		}
		if (query.customerAccountId !== undefined) {
			const customer = await this.customers.findOneBy({
				tenantId,
				id: query.customerAccountId,
			});
			if (customer === null) {
				throw new NotFoundException("Customer account not found.");
			}
		}
		if (query.subscriptionId !== undefined) {
			const subscription = await this.subscriptions.findOneBy({
				tenantId,
				id: query.subscriptionId,
			});
			if (subscription === null) {
				throw new NotFoundException("Subscription not found.");
			}
			if (
				query.customerAccountId !== undefined &&
				subscription.customerAccountId !== query.customerAccountId
			) {
				throw new UnprocessableEntityException(
					"The subscription does not belong to the customer.",
				);
			}
		}

		const base = this.aggregateQuery(tenantId, metric.id, from, to, query);
		const aggregates = await base
			.clone()
			.orderBy("a.period_start", "ASC")
			.addOrderBy("a.customer_account_id", "ASC")
			.addOrderBy("a.scope_key", "ASC")
			.limit(1000)
			.getMany();

		const totals = await base
			.clone()
			.select("COALESCE(SUM(a.event_count), 0)::text", "event_count")
			.addSelect("MAX(a.calculated_at)", "calculated_at")
			.getRawOne<{ event_count: string; calculated_at: Date | null }>();
		const eventCount = Number(totals?.event_count ?? "0");
		const lastCalculatedAt = totals?.calculated_at ?? null;

		let total: string | null;
		if (metric.aggregationMethod === AggregationMethod.LAST) {
			const latest = await base
				.clone()
				.select("a.value::text", "total")
				.orderBy("a.latest_occurred_at", "DESC", "NULLS LAST")
				.addOrderBy("a.latest_event_id", "DESC", "NULLS LAST")
				.limit(1)
				.getRawOne<{ total: string | null }>();
			total = latest?.total ?? null;
			if (total !== null) {
				total = normalizeQuantity(total);
			}
		} else if (metric.aggregationMethod === AggregationMethod.COUNT) {
			total = String(eventCount);
		} else {
			const expression =
				metric.aggregationMethod === AggregationMethod.MAX
					? "MAX(a.value)::text"
					: "COALESCE(SUM(a.value), 0)::text";
			const value = await base
				.clone()
				.select(expression, "total")
				.getRawOne<{ total: string | null }>();
			total = value?.total ?? null;
			if (total !== null) {
				total = normalizeQuantity(total);
			}
		}

		return {
			metric: {
				id: metric.id,
				code: metric.code,
				name: metric.name,
				unit: metric.unit,
				aggregationMethod: metric.aggregationMethod,
			},
			from: from.toISOString(),
			to: to.toISOString(),
			total,
			eventCount,
			aggregates: aggregates.map((aggregate) => ({
				id: aggregate.id,
				customerAccountId: aggregate.customerAccountId,
				subscriptionId: aggregate.subscriptionId,
				periodStart: aggregate.periodStart.toISOString(),
				periodEnd: aggregate.periodEnd.toISOString(),
				dimensions: aggregate.dimensions,
				value: normalizeQuantity(aggregate.value) ?? aggregate.value,
				eventCount: Number(aggregate.eventCount),
				revision: aggregate.revision,
				calculatedAt: aggregate.calculatedAt.toISOString(),
			})),
			freshness: {
				lastCalculatedAt:
					lastCalculatedAt === null ? null : lastCalculatedAt.toISOString(),
			},
		};
	}

	private aggregateQuery(
		tenantId: string,
		metricId: string,
		from: Date,
		to: Date,
		query: UsageSummaryQueryDto,
	): SelectQueryBuilder<UsageAggregate> {
		const builder = this.aggregates
			.createQueryBuilder("a")
			.where("a.tenant_id = :tenantId", { tenantId })
			.andWhere("a.metric_id = :metricId", { metricId })
			.andWhere("a.period_start >= :from", { from })
			.andWhere("a.period_end <= :to", { to });
		if (query.customerAccountId !== undefined) {
			builder.andWhere("a.customer_account_id = :customerAccountId", {
				customerAccountId: query.customerAccountId,
			});
		}
		if (query.subscriptionId !== undefined) {
			builder.andWhere("a.subscription_id = :subscriptionId", {
				subscriptionId: query.subscriptionId,
			});
		}
		return builder;
	}

	private encodeCursor(event: UsageEvent): string {
		return Buffer.from(
			JSON.stringify({
				occurredAt: event.occurredAt.toISOString(),
				id: event.id,
			}),
			"utf8",
		).toString("base64url");
	}

	private decodeCursor(cursor: string): { occurredAt: Date; id: string } {
		try {
			const parsed = JSON.parse(
				Buffer.from(cursor, "base64url").toString("utf8"),
			) as { occurredAt?: unknown; id?: unknown };
			if (
				typeof parsed.occurredAt !== "string" ||
				typeof parsed.id !== "string"
			) {
				throw new Error("Invalid cursor shape.");
			}
			const occurredAt = new Date(parsed.occurredAt);
			if (Number.isNaN(occurredAt.getTime())) {
				throw new Error("Invalid cursor timestamp.");
			}
			return { occurredAt, id: parsed.id };
		} catch {
			throw new UnprocessableEntityException("cursor is invalid.");
		}
	}

	toBody(event: UsageEvent): UsageEventBody {
		return {
			id: event.id,
			externalEventId: event.externalEventId,
			source: event.source,
			customerAccountId: event.customerAccountId,
			subscriptionId: event.subscriptionId,
			metricId: event.metricId,
			quantity: normalizeQuantity(event.quantity) ?? event.quantity,
			dimensions: event.dimensions,
			occurredAt: event.occurredAt.toISOString(),
			receivedAt: event.receivedAt.toISOString(),
			status: event.status,
		};
	}

	private firstMessage(
		errors: Array<{
			constraints?: Record<string, string>;
			children?: unknown[];
		}>,
	): string {
		for (const error of errors) {
			const messages = Object.values(error.constraints ?? {});
			if (messages.length > 0) {
				return messages[0];
			}
		}
		return "The event is invalid.";
	}
}
