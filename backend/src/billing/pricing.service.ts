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

import { PlanVersion } from "../catalog/entities/plan-version.entity";
import { Plan } from "../catalog/entities/plan.entity";
import { UsageMetric } from "../catalog/entities/usage-metric.entity";
import { isUniqueViolation } from "../common/database-errors";
// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "../identity/audit.service";
import { ActorType } from "../identity/enums";
import { Subscription } from "../subscriptions/entities/subscription.entity";
import {
	currencyPrecision,
	formatDecimal,
	parseDecimal,
} from "./billing-money";
import type { CreatePriceDto, CreateSubscriptionItemDto } from "./billing.dto";
import { Price } from "./entities/price.entity";
import { SubscriptionItem } from "./entities/subscription-item.entity";
import { type BillingInterval, PriceStatus, PricingModel } from "./enums";

export interface PriceBody {
	id: string;
	planId: string;
	priceCode: string;
	versionNumber: number;
	currency: string;
	billingInterval: BillingInterval;
	pricingModel: PricingModel;
	effectiveFrom: string;
	effectiveUntil: string | null;
	configuration: Record<string, unknown>;
	status: PriceStatus;
	createdAt: string;
}

export interface SubscriptionItemBody {
	id: string;
	subscriptionId: string;
	priceId: string;
	quantity: string;
	description: string | null;
	price: PriceBody;
}

interface PriceRow {
	id: string;
	planId: string;
	priceCode: string;
	versionNumber: number;
	currency: string;
	billingInterval: BillingInterval;
	pricingModel: PricingModel;
	effectiveFrom: Date;
	effectiveUntil: Date | null;
	configuration: Record<string, unknown>;
	status: PriceStatus;
	createdAt: Date;
}

interface ItemRow {
	id: string;
	subscriptionId: string;
	priceId: string;
	quantity: string;
	description: string | null;
}

@Injectable()
export class PricingService {
	constructor(
		@InjectRepository(Price)
		private readonly prices: Repository<Price>,
		@InjectRepository(SubscriptionItem)
		private readonly items: Repository<SubscriptionItem>,
		@InjectRepository(Plan)
		private readonly plans: Repository<Plan>,
		@InjectRepository(PlanVersion)
		private readonly versions: Repository<PlanVersion>,
		@InjectRepository(Subscription)
		private readonly subscriptions: Repository<Subscription>,
		@InjectRepository(UsageMetric)
		private readonly metrics: Repository<UsageMetric>,
		private readonly dataSource: DataSource,
		private readonly audit: AuditService,
	) {}

	async createPrice(
		tenantId: string,
		identityId: string,
		planId: string,
		dto: CreatePriceDto,
	): Promise<PriceBody> {
		const plan = await this.plans.findOneBy({ tenantId, id: planId });
		if (plan === null) {
			throw new NotFoundException("Plan not found.");
		}
		const currency = dto.currency.toUpperCase();
		if (currencyPrecision(currency) === null) {
			throw new UnprocessableEntityException(
				`Currency ${currency} is not supported.`,
			);
		}
		const effectiveFrom =
			dto.effectiveFrom === undefined
				? new Date()
				: new Date(dto.effectiveFrom);
		const effectiveUntil =
			dto.effectiveUntil === undefined ? null : new Date(dto.effectiveUntil);
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
		const configuration = await this.normalizeConfiguration(
			tenantId,
			dto.pricingModel,
			dto.configuration,
		);

		let price: PriceRow;
		try {
			price = await this.dataSource.transaction(async (manager) => {
				await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
					`price:${tenantId}:${planId}:${dto.priceCode}`,
				]);
				const overlap = (await manager.query(
					`
				SELECT id FROM prices
				WHERE tenant_id = $1 AND plan_id = $2 AND price_code = $3
					AND status = 'active'
					AND effective_from < COALESCE($5::timestamptz, 'infinity')
					AND (effective_until IS NULL OR effective_until > $4)
				LIMIT 1
				`,
					[tenantId, planId, dto.priceCode, effectiveFrom, effectiveUntil],
				)) as Array<{ id: string }>;
				if (overlap[0] !== undefined) {
					throw new ConflictException(
						"An active price with this code already covers the effective period.",
					);
				}
				const versionNumber =
					dto.versionNumber ??
					((
						await manager.query(
							`
						SELECT COALESCE(MAX(version_number), 0) + 1 AS next
						FROM prices
						WHERE tenant_id = $1 AND plan_id = $2 AND price_code = $3
						`,
							[tenantId, planId, dto.priceCode],
						)
					)[0]?.next as number | undefined) ??
					1;
				const inserted = (await manager.query(
					`
				INSERT INTO prices (
					tenant_id, plan_id, price_code, version_number, currency,
					billing_interval, pricing_model, effective_from, effective_until,
					configuration, status
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'active')
				RETURNING id, plan_id AS "planId", price_code AS "priceCode",
					version_number AS "versionNumber", currency,
					billing_interval AS "billingInterval",
					pricing_model AS "pricingModel",
					effective_from AS "effectiveFrom",
					effective_until AS "effectiveUntil", configuration, status,
					created_at AS "createdAt"
				`,
					[
						tenantId,
						planId,
						dto.priceCode,
						versionNumber,
						currency,
						dto.billingInterval,
						dto.pricingModel,
						effectiveFrom,
						effectiveUntil,
						JSON.stringify(configuration),
					],
				)) as PriceRow[];
				const row = inserted[0];
				if (row === undefined) {
					throw new Error("The price could not be created.");
				}
				return row;
			});
		} catch (error: unknown) {
			if (isUniqueViolation(error)) {
				throw new ConflictException("This price version already exists.");
			}
			throw error;
		}

		await this.audit.record({
			tenantId,
			actorType: ActorType.HUMAN,
			actorId: identityId,
			action: "price.created",
			resourceType: "price",
			resourceId: price.id,
			metadata: {
				planId,
				priceCode: price.priceCode,
				versionNumber: price.versionNumber,
				pricingModel: price.pricingModel,
			},
		});
		return this.toPriceBody(price);
	}

	async listPrices(tenantId: string, planId: string): Promise<PriceBody[]> {
		const plan = await this.plans.findOneBy({ tenantId, id: planId });
		if (plan === null) {
			throw new NotFoundException("Plan not found.");
		}
		const rows = (await this.dataSource.query(
			`
			SELECT id, plan_id AS "planId", price_code AS "priceCode",
				version_number AS "versionNumber", currency,
				billing_interval AS "billingInterval",
				pricing_model AS "pricingModel",
				effective_from AS "effectiveFrom",
				effective_until AS "effectiveUntil", configuration, status,
				created_at AS "createdAt"
			FROM prices
			WHERE tenant_id = $1 AND plan_id = $2
			ORDER BY price_code ASC, version_number DESC
			`,
			[tenantId, planId],
		)) as PriceRow[];
		return rows.map((row) => this.toPriceBody(row));
	}

	async createItem(
		tenantId: string,
		identityId: string,
		subscriptionId: string,
		dto: CreateSubscriptionItemDto,
	): Promise<SubscriptionItemBody> {
		const subscription = await this.subscriptions.findOneBy({
			tenantId,
			id: subscriptionId,
		});
		if (subscription === null) {
			throw new NotFoundException("Subscription not found.");
		}
		const price = await this.prices.findOneBy({
			tenantId,
			id: dto.priceId,
		});
		if (price === null) {
			throw new NotFoundException("Price not found.");
		}
		const version = await this.versions.findOneBy({
			tenantId,
			id: subscription.planVersionId,
		});
		if (version === null || version.planId !== price.planId) {
			throw new UnprocessableEntityException(
				"The price does not belong to the subscription's plan.",
			);
		}
		if (price.status !== PriceStatus.ACTIVE) {
			throw new UnprocessableEntityException("The price is archived.");
		}
		const quantity = dto.quantity ?? "1";
		const parsed = parseDecimal(quantity);
		if (parsed === null || parsed <= 0n) {
			throw new UnprocessableEntityException("quantity must be positive.");
		}
		const item = this.items.create({
			tenantId,
			subscriptionId,
			priceId: price.id,
			quantity: formatDecimal(parsed),
			description: dto.description ?? null,
		});
		try {
			await this.items.save(item);
		} catch (error: unknown) {
			if (isUniqueViolation(error)) {
				throw new ConflictException(
					"This price is already attached to the subscription.",
				);
			}
			throw error;
		}
		await this.audit.record({
			tenantId,
			actorType: ActorType.HUMAN,
			actorId: identityId,
			action: "subscription_item.created",
			resourceType: "subscription_item",
			resourceId: item.id,
			metadata: { subscriptionId, priceId: price.id },
		});
		return {
			id: item.id,
			subscriptionId,
			priceId: price.id,
			quantity: formatDecimal(parsed),
			description: item.description,
			price: this.toPriceBody(price),
		};
	}

	async listItems(
		tenantId: string,
		subscriptionId: string,
	): Promise<SubscriptionItemBody[]> {
		const subscription = await this.subscriptions.findOneBy({
			tenantId,
			id: subscriptionId,
		});
		if (subscription === null) {
			throw new NotFoundException("Subscription not found.");
		}
		const rows = (await this.dataSource.query(
			`
			SELECT i.id, i.subscription_id AS "subscriptionId",
				i.price_id AS "priceId", i.quantity, i.description,
				p.id AS "price_id", p.plan_id AS "planId",
				p.price_code AS "priceCode", p.version_number AS "versionNumber",
				p.currency, p.billing_interval AS "billingInterval",
				p.pricing_model AS "pricingModel",
				p.effective_from AS "effectiveFrom",
				p.effective_until AS "effectiveUntil", p.configuration,
				p.status, p.created_at AS "priceCreatedAt"
			FROM subscription_items i
			JOIN prices p
				ON p.tenant_id = i.tenant_id AND p.id = i.price_id
			WHERE i.tenant_id = $1 AND i.subscription_id = $2
			ORDER BY p.price_code ASC
			`,
			[tenantId, subscriptionId],
		)) as Array<
			ItemRow & {
				planId: string;
				priceCode: string;
				versionNumber: number;
				currency: string;
				billingInterval: BillingInterval;
				pricingModel: PricingModel;
				effectiveFrom: Date;
				effectiveUntil: Date | null;
				configuration: Record<string, unknown>;
				status: PriceStatus;
				priceCreatedAt: Date;
			}
		>;
		return rows.map((row) => {
			const quantity = parseDecimal(row.quantity);
			return {
				id: row.id,
				subscriptionId: row.subscriptionId,
				priceId: row.priceId,
				quantity: quantity === null ? row.quantity : formatDecimal(quantity),
				description: row.description,
				price: this.toPriceBody({
					id: row.priceId,
					planId: row.planId,
					priceCode: row.priceCode,
					versionNumber: row.versionNumber,
					currency: row.currency,
					billingInterval: row.billingInterval,
					pricingModel: row.pricingModel,
					effectiveFrom: row.effectiveFrom,
					effectiveUntil: row.effectiveUntil,
					configuration: row.configuration,
					status: row.status,
					createdAt: row.priceCreatedAt,
				}),
			};
		});
	}

	private async normalizeConfiguration(
		tenantId: string,
		model: PricingModel,
		raw: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const allowedKeys =
			model === PricingModel.METERED
				? new Set(["metricId", "unitAmount", "includedUnits"])
				: new Set(model === PricingModel.FLAT ? ["amount"] : ["unitAmount"]);
		for (const key of Object.keys(raw)) {
			if (!allowedKeys.has(key)) {
				throw new UnprocessableEntityException(
					`Unknown pricing configuration field ${key}.`,
				);
			}
		}
		if (model === PricingModel.FLAT) {
			const amount = this.requireAmount(raw.amount, "amount");
			return { amount };
		}
		if (model === PricingModel.PER_UNIT) {
			const unitAmount = this.requireAmount(raw.unitAmount, "unitAmount");
			return { unitAmount };
		}
		const metricId = raw.metricId;
		if (typeof metricId !== "string") {
			throw new UnprocessableEntityException("metricId is required.");
		}
		const metric = await this.metrics.findOneBy({ tenantId, id: metricId });
		if (metric === null) {
			throw new NotFoundException("Usage metric not found.");
		}
		const configuration: Record<string, unknown> = {
			metricId,
			unitAmount: this.requireAmount(raw.unitAmount, "unitAmount"),
		};
		if (raw.includedUnits !== undefined) {
			configuration.includedUnits = this.requireAmount(
				raw.includedUnits,
				"includedUnits",
			);
		}
		return configuration;
	}

	private requireAmount(raw: unknown, field: string): string {
		if (typeof raw !== "string") {
			throw new UnprocessableEntityException(
				`${field} must be a decimal string.`,
			);
		}
		const parsed = parseDecimal(raw);
		if (parsed === null) {
			throw new UnprocessableEntityException(`${field} is not a valid amount.`);
		}
		return formatDecimal(parsed);
	}

	private toPriceBody(row: PriceRow): PriceBody {
		return {
			id: row.id,
			planId: row.planId,
			priceCode: row.priceCode,
			versionNumber: row.versionNumber,
			currency: row.currency,
			billingInterval: row.billingInterval,
			pricingModel: row.pricingModel,
			effectiveFrom: row.effectiveFrom.toISOString(),
			effectiveUntil:
				row.effectiveUntil === null ? null : row.effectiveUntil.toISOString(),
			configuration: row.configuration,
			status: row.status,
			createdAt: row.createdAt.toISOString(),
		};
	}
}
