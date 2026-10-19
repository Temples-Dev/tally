import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

import { UsageMetric } from "../../catalog/entities/usage-metric.entity";
import { AggregationMethod } from "../../catalog/enums";
import { UsageAggregate } from "../entities/usage-aggregate.entity";
import { normalizeQuantity } from "../usage-payload";
import {
	type AggregationScope,
	aggregateScopeKey,
} from "./usage-aggregation.types";

interface EventTotalsRow {
	event_count: string;
	sum_value: string;
	max_value: string;
	last_value: string | null;
	latest_occurred_at: Date | null;
	latest_event_id: string | null;
}

@Injectable()
export class UsageAggregationService {
	constructor(
		@InjectRepository(UsageAggregate)
		private readonly aggregates: Repository<UsageAggregate>,
		@InjectRepository(UsageMetric)
		private readonly metrics: Repository<UsageMetric>,
		private readonly dataSource: DataSource,
	) {}

	/**
	 * Recomputes one UTC-day aggregate scope from accepted source events.
	 * Safe to run repeatedly: the value is replaced and the revision only
	 * advances when the computed result changes.
	 */
	async recompute(scope: AggregationScope): Promise<UsageAggregate | null> {
		const metric = await this.metrics.findOneBy({
			tenantId: scope.tenantId,
			id: scope.metricId,
		});
		if (metric === null) {
			throw new NotFoundException("Usage metric not found.");
		}
		const scopeKey = aggregateScopeKey(scope);
		const rows = (await this.dataSource.query(
			`
			SELECT
				COUNT(*)::text AS event_count,
				COALESCE(SUM(quantity), 0)::text AS sum_value,
				COALESCE(MAX(quantity), 0)::text AS max_value,
				(ARRAY_AGG(quantity ORDER BY occurred_at DESC, id DESC))[1]::text
					AS last_value,
				MAX(occurred_at) AS latest_occurred_at,
				(ARRAY_AGG(id ORDER BY occurred_at DESC, id DESC))[1]
					AS latest_event_id
			FROM usage_events
			WHERE tenant_id = $1
				AND metric_id = $2
				AND occurred_at >= $3
				AND occurred_at < $4
				AND customer_account_id = $5
				AND subscription_id IS NOT DISTINCT FROM $6::uuid
				AND dimensions = $7::jsonb
			`,
			[
				scope.tenantId,
				scope.metricId,
				scope.periodStart,
				scope.periodEnd,
				scope.customerAccountId,
				scope.subscriptionId,
				JSON.stringify(scope.dimensions),
			],
		)) as EventTotalsRow[];
		const totals = rows[0];
		const eventCount = Number(totals?.event_count ?? "0");

		if (totals === undefined || eventCount === 0) {
			await this.aggregates.delete({
				tenantId: scope.tenantId,
				periodStart: scope.periodStart,
				periodEnd: scope.periodEnd,
				scopeKey,
			});
			return null;
		}

		const value = this.selectValue(
			metric.aggregationMethod,
			totals,
			eventCount,
		);
		if (value === null) {
			throw new Error("The aggregate value could not be normalized.");
		}

		await this.dataSource.query(
			`
			INSERT INTO usage_aggregates (
				tenant_id,
				customer_account_id,
				subscription_id,
				metric_id,
				period_start,
				period_end,
				dimensions,
				scope_key,
				aggregation_method,
				value,
				event_count,
				latest_occurred_at,
				latest_event_id,
				calculated_at
			)
			VALUES (
				$1, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12,
				$13::uuid, now()
			)
			ON CONFLICT (tenant_id, period_start, period_end, scope_key)
			DO UPDATE SET
				customer_account_id = EXCLUDED.customer_account_id,
				subscription_id = EXCLUDED.subscription_id,
				metric_id = EXCLUDED.metric_id,
				dimensions = EXCLUDED.dimensions,
				aggregation_method = EXCLUDED.aggregation_method,
				value = EXCLUDED.value,
				event_count = EXCLUDED.event_count,
				latest_occurred_at = EXCLUDED.latest_occurred_at,
				latest_event_id = EXCLUDED.latest_event_id,
				revision = usage_aggregates.revision + CASE
					WHEN usage_aggregates.value IS DISTINCT FROM EXCLUDED.value
						OR usage_aggregates.event_count
							IS DISTINCT FROM EXCLUDED.event_count
						OR usage_aggregates.latest_event_id
							IS DISTINCT FROM EXCLUDED.latest_event_id
					THEN 1
					ELSE 0
				END,
				calculated_at = now(),
				updated_at = now()
			`,
			[
				scope.tenantId,
				scope.customerAccountId,
				scope.subscriptionId,
				scope.metricId,
				scope.periodStart,
				scope.periodEnd,
				JSON.stringify(scope.dimensions),
				scopeKey,
				metric.aggregationMethod,
				value,
				eventCount,
				totals.latest_occurred_at,
				totals.latest_event_id,
			],
		);

		return this.aggregates.findOneBy({
			tenantId: scope.tenantId,
			periodStart: scope.periodStart,
			periodEnd: scope.periodEnd,
			scopeKey,
		});
	}

	private selectValue(
		method: AggregationMethod,
		totals: EventTotalsRow,
		eventCount: number,
	): string | null {
		switch (method) {
			case AggregationMethod.SUM:
				return normalizeQuantity(totals.sum_value);
			case AggregationMethod.COUNT:
				return String(eventCount);
			case AggregationMethod.MAX:
				return normalizeQuantity(totals.max_value);
			case AggregationMethod.LAST:
				return totals.last_value === null
					? null
					: normalizeQuantity(totals.last_value);
		}
	}
}
