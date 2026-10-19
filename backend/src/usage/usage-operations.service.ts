import {
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
import { CustomerAccount } from "../subscriptions/entities/customer-account.entity";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import { USAGE_AGGREGATION_JOB } from "./aggregation/usage-aggregation.types";
import { normalizeQuantity } from "./usage-payload";
import { parseUtcDayRange } from "./usage-range";
import type {
	UsageProcessingStatusQueryDto,
	UsageSummaryQueryDto,
} from "./usage.dto";

interface JobStatusRow {
	queued: string;
	running: string;
	dead: string;
	oldest_queued_at: Date | null;
	last_completed_at: Date | null;
}

interface EventStatusRow {
	event_count: string;
	latest_received_at: Date | null;
}

interface CalculatedRow {
	last_calculated_at: Date | null;
}

interface EventTotalsRow {
	event_count: string;
	sum_value: string;
	max_value: string | null;
	last_value: string | null;
}

interface AggregateTotalsRow {
	event_count: string;
	sum_value: string;
	max_value: string | null;
	last_value: string | null;
}

export interface UsageProcessingStatusBody {
	metricId: string | null;
	backlog: {
		queued: number;
		running: number;
		dead: number;
		oldestQueuedAt: string | null;
		lastCompletedAt: string | null;
	};
	events: { count: number; latestReceivedAt: string | null };
	aggregates: { lastCalculatedAt: string | null };
	backlogClear: boolean;
}

export interface UsageReconciliationBody {
	metric: {
		id: string;
		code: string;
		unit: string;
		aggregationMethod: AggregationMethod;
	};
	from: string;
	to: string;
	eventTotal: string | null;
	aggregateTotal: string | null;
	eventCount: number;
	aggregateEventCount: number;
	matches: boolean;
	difference: string | null;
	checkedAt: string;
}

@Injectable()
export class UsageOperationsService {
	constructor(
		@InjectRepository(UsageMetric)
		private readonly metrics: Repository<UsageMetric>,
		@InjectRepository(CustomerAccount)
		private readonly customers: Repository<CustomerAccount>,
		@InjectRepository(Subscription)
		private readonly subscriptions: Repository<Subscription>,
		private readonly dataSource: DataSource,
	) {}

	async processingStatus(
		tenantId: string,
		query: UsageProcessingStatusQueryDto,
	): Promise<UsageProcessingStatusBody> {
		if (query.metricId !== undefined) {
			await this.requireMetric(tenantId, query.metricId);
		}

		const jobParameters: unknown[] = [tenantId, USAGE_AGGREGATION_JOB];
		let jobFilter = "tenant_id = $1 AND job_type = $2";
		if (query.metricId !== undefined) {
			jobParameters.push(query.metricId);
			jobFilter += " AND payload->>'metricId' = $3";
		}
		const jobs = (await this.dataSource.query(
			`
			SELECT
				COUNT(*) FILTER (
					WHERE status IN ('pending', 'failed')
				)::text AS queued,
				COUNT(*) FILTER (WHERE status = 'running')::text AS running,
				COUNT(*) FILTER (WHERE status = 'dead')::text AS dead,
				MIN(available_at) FILTER (
					WHERE status IN ('pending', 'failed')
				) AS oldest_queued_at,
				MAX(updated_at) FILTER (
					WHERE status = 'succeeded'
				) AS last_completed_at
			FROM background_jobs
			WHERE ${jobFilter}
			`,
			jobParameters,
		)) as JobStatusRow[];

		const metricParameters: unknown[] = [tenantId];
		let metricFilter = "tenant_id = $1";
		if (query.metricId !== undefined) {
			metricParameters.push(query.metricId);
			metricFilter += " AND metric_id = $2";
		}
		const events = (await this.dataSource.query(
			`
			SELECT
				COUNT(*)::text AS event_count,
				MAX(received_at) AS latest_received_at
			FROM usage_events
			WHERE ${metricFilter}
			`,
			metricParameters,
		)) as EventStatusRow[];
		const calculated = (await this.dataSource.query(
			`
			SELECT MAX(calculated_at) AS last_calculated_at
			FROM usage_aggregates
			WHERE ${metricFilter}
			`,
			metricParameters,
		)) as CalculatedRow[];

		const job = jobs[0];
		const event = events[0];
		const aggregate = calculated[0];
		const queued = Number(job?.queued ?? "0");
		const running = Number(job?.running ?? "0");
		const dead = Number(job?.dead ?? "0");

		return {
			metricId: query.metricId ?? null,
			backlog: {
				queued,
				running,
				dead,
				oldestQueuedAt: this.toIso(job?.oldest_queued_at ?? null),
				lastCompletedAt: this.toIso(job?.last_completed_at ?? null),
			},
			events: {
				count: Number(event?.event_count ?? "0"),
				latestReceivedAt: this.toIso(event?.latest_received_at ?? null),
			},
			aggregates: {
				lastCalculatedAt: this.toIso(aggregate?.last_calculated_at ?? null),
			},
			backlogClear: queued === 0 && running === 0 && dead === 0,
		};
	}

	async reconciliation(
		tenantId: string,
		query: UsageSummaryQueryDto,
	): Promise<UsageReconciliationBody> {
		const { from, to } = parseUtcDayRange(query.from, query.to);
		const metric = await this.requireScope(tenantId, query);

		const eventParameters: unknown[] = [tenantId, metric.id, from, to];
		let eventFilter =
			"tenant_id = $1 AND metric_id = $2 AND occurred_at >= $3 AND occurred_at < $4";
		if (query.customerAccountId !== undefined) {
			eventParameters.push(query.customerAccountId);
			eventFilter += ` AND customer_account_id = $${eventParameters.length}`;
		}
		if (query.subscriptionId !== undefined) {
			eventParameters.push(query.subscriptionId);
			eventFilter += ` AND subscription_id = $${eventParameters.length}`;
		}

		const aggregateParameters: unknown[] = [tenantId, metric.id, from, to];
		let aggregateFilter =
			"tenant_id = $1 AND metric_id = $2 AND period_start >= $3 AND period_end <= $4";
		if (query.customerAccountId !== undefined) {
			aggregateParameters.push(query.customerAccountId);
			aggregateFilter += ` AND customer_account_id = $${aggregateParameters.length}`;
		}
		if (query.subscriptionId !== undefined) {
			aggregateParameters.push(query.subscriptionId);
			aggregateFilter += ` AND subscription_id = $${aggregateParameters.length}`;
		}

		const eventRows = (await this.dataSource.query(
			`
			SELECT
				COUNT(*)::text AS event_count,
				COALESCE(SUM(quantity), 0)::text AS sum_value,
				MAX(quantity)::text AS max_value,
				(ARRAY_AGG(quantity ORDER BY occurred_at DESC, id DESC))[1]::text
					AS last_value
			FROM usage_events
			WHERE ${eventFilter}
			`,
			eventParameters,
		)) as EventTotalsRow[];
		const aggregateRows = (await this.dataSource.query(
			`
			SELECT
				COALESCE(SUM(event_count), 0)::text AS event_count,
				COALESCE(SUM(value), 0)::text AS sum_value,
				MAX(value)::text AS max_value
			FROM usage_aggregates
			WHERE ${aggregateFilter}
			`,
			aggregateParameters,
		)) as AggregateTotalsRow[];
		const lastAggregateRows = (await this.dataSource.query(
			`
			SELECT value::text AS last_value
			FROM usage_aggregates
			WHERE ${aggregateFilter}
			ORDER BY latest_occurred_at DESC NULLS LAST,
				latest_event_id DESC NULLS LAST
			LIMIT 1
			`,
			aggregateParameters,
		)) as Array<{ last_value: string }>;

		const eventTotals = eventRows[0];
		const aggregateTotals = aggregateRows[0];
		const aggregateLast = lastAggregateRows[0]?.last_value ?? null;
		const eventCount = Number(eventTotals?.event_count ?? "0");
		const aggregateEventCount = Number(aggregateTotals?.event_count ?? "0");
		const eventTotal = this.selectValue(
			metric.aggregationMethod,
			eventCount,
			eventTotals?.sum_value ?? "0",
			eventTotals?.max_value ?? null,
			eventTotals?.last_value ?? null,
		);
		const aggregateTotal = this.selectValue(
			metric.aggregationMethod,
			aggregateEventCount,
			aggregateTotals?.sum_value ?? "0",
			aggregateTotals?.max_value ?? null,
			aggregateLast,
		);

		let difference: string | null = null;
		if (
			metric.aggregationMethod === AggregationMethod.SUM ||
			metric.aggregationMethod === AggregationMethod.COUNT
		) {
			const rows = (await this.dataSource.query(
				"SELECT (($1::numeric) - ($2::numeric))::text AS difference",
				[eventTotal, aggregateTotal],
			)) as Array<{ difference: string }>;
			difference =
				rows[0] === undefined
					? null
					: (normalizeQuantity(rows[0].difference) ?? rows[0].difference);
		}

		return {
			metric: {
				id: metric.id,
				code: metric.code,
				unit: metric.unit,
				aggregationMethod: metric.aggregationMethod,
			},
			from: from.toISOString(),
			to: to.toISOString(),
			eventTotal,
			aggregateTotal,
			eventCount,
			aggregateEventCount,
			matches:
				eventTotal === aggregateTotal && eventCount === aggregateEventCount,
			difference,
			checkedAt: new Date().toISOString(),
		};
	}

	private selectValue(
		method: AggregationMethod,
		eventCount: number,
		sumValue: string,
		maxValue: string | null,
		lastValue: string | null,
	): string | null {
		switch (method) {
			case AggregationMethod.SUM:
				return normalizeQuantity(sumValue);
			case AggregationMethod.COUNT:
				return String(eventCount);
			case AggregationMethod.MAX:
				return maxValue === null ? null : normalizeQuantity(maxValue);
			case AggregationMethod.LAST:
				return lastValue === null ? null : normalizeQuantity(lastValue);
		}
	}

	private async requireMetric(
		tenantId: string,
		metricId: string,
	): Promise<UsageMetric> {
		const metric = await this.metrics.findOneBy({ tenantId, id: metricId });
		if (metric === null) {
			throw new NotFoundException("Usage metric not found.");
		}
		return metric;
	}

	private async requireScope(
		tenantId: string,
		query: UsageSummaryQueryDto,
	): Promise<UsageMetric> {
		const metric = await this.requireMetric(tenantId, query.metricId);
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
		return metric;
	}

	private toIso(value: Date | null): string | null {
		return value === null ? null : value.toISOString();
	}
}
