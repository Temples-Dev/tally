import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, type Repository } from "typeorm";

import { EntitlementDefinition } from "../catalog/entities/entitlement-definition.entity";
import { PlanEntitlement } from "../catalog/entities/plan-entitlement.entity";
import { PlanVersion } from "../catalog/entities/plan-version.entity";
import { PlanVersionStatus } from "../catalog/enums";
import { validateEntitlementValue } from "../catalog/value-validation";
import { Tenant } from "../identity/entities/tenant.entity";
import { TenantStatus } from "../identity/enums";
import { EntitlementOverride } from "./entities/entitlement-override.entity";
import { Subscription } from "./entities/subscription.entity";
import { SubscriptionStatus } from "./enums";

export interface EntitlementDecision {
	tenantId: string;
	key: string;
	allowed: boolean;
	value: unknown;
	reason: string;
	evaluatedAt: string;
	source:
		| { type: "plan"; planVersionId: string; subscriptionId: string }
		| { type: "override"; overrideId: string; subscriptionId: string }
		| { type: "none" };
}

@Injectable()
export class EntitlementsService {
	constructor(
		@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
		@InjectRepository(Subscription)
		private readonly subscriptions: Repository<Subscription>,
		@InjectRepository(PlanVersion)
		private readonly versions: Repository<PlanVersion>,
		@InjectRepository(PlanEntitlement)
		private readonly planEntitlements: Repository<PlanEntitlement>,
		@InjectRepository(EntitlementDefinition)
		private readonly definitions: Repository<EntitlementDefinition>,
		@InjectRepository(EntitlementOverride)
		private readonly overrides: Repository<EntitlementOverride>,
	) {}

	async listDefinitions(tenantId: string): Promise<EntitlementDecision[]> {
		const definitions = await this.definitions.find({
			where: { tenantId },
			order: { code: "ASC" },
		});
		const decisions: EntitlementDecision[] = [];
		for (const definition of definitions) {
			decisions.push(
				await this.evaluate(tenantId, definition.code, new Date()),
			);
		}
		return decisions;
	}

	async evaluate(
		tenantId: string,
		key: string,
		at: Date,
	): Promise<EntitlementDecision> {
		const evaluatedAt = at.toISOString();
		const deny = (
			reason: string,
			value: unknown = null,
		): EntitlementDecision => ({
			tenantId,
			key,
			allowed: false,
			value,
			reason,
			evaluatedAt,
			source: { type: "none" },
		});

		const tenant = await this.tenants.findOneBy({ id: tenantId });
		if (tenant === null) {
			throw new NotFoundException("Tenant not found.");
		}
		if (tenant.status !== TenantStatus.ACTIVE) {
			return deny("TENANT_SUSPENDED");
		}

		const definition = await this.definitions.findOneBy({
			tenantId,
			code: key,
		});
		if (definition === null) {
			return deny("UNKNOWN_KEY");
		}

		const eligible = await this.subscriptions.find({
			where: [
				{ tenantId, status: SubscriptionStatus.TRIALING },
				{ tenantId, status: SubscriptionStatus.ACTIVE },
				{ tenantId, status: SubscriptionStatus.PAST_DUE },
			],
			order: { createdAt: "DESC" },
		});
		if (eligible.length === 0) {
			return deny("NOT_SUBSCRIBED");
		}

		// A tenant may hold independent subscriptions for different products.
		// Resolve the key against the subscriptions whose published plan grants
		// it rather than treating every eligible subscription as a conflict.
		const granting: Array<{
			subscription: Subscription;
			version: PlanVersion;
			baseline: PlanEntitlement;
		}> = [];
		for (const subscription of eligible) {
			const version = await this.versions.findOneBy({
				tenantId,
				id: subscription.planVersionId,
			});
			if (version === null || version.status !== PlanVersionStatus.PUBLISHED) {
				continue;
			}
			const baseline = await this.planEntitlements.findOneBy({
				tenantId,
				planVersionId: version.id,
				entitlementDefinitionId: definition.id,
			});
			if (baseline === null) {
				continue;
			}
			granting.push({ subscription, version, baseline });
		}
		if (granting.length === 0) {
			return deny("NOT_GRANTED");
		}
		if (granting.length > 1) {
			return deny("AMBIGUOUS_SUBSCRIPTIONS");
		}
		const { subscription, version, baseline } = granting[0];

		if (subscription.status === SubscriptionStatus.TRIALING) {
			if (subscription.trialEndsAt === null || at > subscription.trialEndsAt) {
				return deny("TRIAL_EXPIRED");
			}
		}
		if (subscription.status === SubscriptionStatus.PAST_DUE) {
			return deny("PAST_DUE");
		}
		if (
			subscription.cancelAtPeriodEnd &&
			subscription.currentPeriodEnd !== null &&
			at >= subscription.currentPeriodEnd
		) {
			return deny("CANCELLED");
		}

		const baselineProblem = validateEntitlementValue(
			definition.valueType,
			baseline.value,
			definition.validationSchema,
		);
		if (baselineProblem !== null) {
			return deny("INVALID_VALUE");
		}

		const applicable = await this.overrides.find({
			where: {
				tenantId,
				subscriptionId: subscription.id,
				entitlementDefinitionId: definition.id,
				effectiveFrom: LessThanOrEqual(at),
			},
			order: { effectiveFrom: "DESC" },
		});
		const active = applicable.filter(
			(override) =>
				override.effectiveUntil === null || at < override.effectiveUntil,
		);
		if (
			active.length > 1 &&
			active[0].effectiveFrom.getTime() === active[1].effectiveFrom.getTime()
		) {
			return deny("AMBIGUOUS_OVERRIDE");
		}
		if (active.length > 0) {
			const override = active[0];
			const problem = validateEntitlementValue(
				definition.valueType,
				override.value,
				definition.validationSchema,
			);
			if (problem !== null) {
				return deny("INVALID_VALUE");
			}
			return {
				tenantId,
				key,
				allowed: true,
				value: override.value,
				reason: "OVERRIDE",
				evaluatedAt,
				source: {
					type: "override",
					overrideId: override.id,
					subscriptionId: subscription.id,
				},
			};
		}

		return {
			tenantId,
			key,
			allowed: true,
			value: baseline.value,
			reason: "PLAN_BASELINE",
			evaluatedAt,
			source: {
				type: "plan",
				planVersionId: version.id,
				subscriptionId: subscription.id,
			},
		};
	}

	async createOverride(
		tenantId: string,
		identityId: string,
		input: {
			subscriptionId: string;
			definitionCode: string;
			value: unknown;
			reason: string;
			effectiveFrom: Date;
			effectiveUntil?: Date | null;
		},
	): Promise<EntitlementOverride> {
		const subscription = await this.subscriptions.findOneBy({
			tenantId,
			id: input.subscriptionId,
		});
		if (subscription === null) {
			throw new NotFoundException("Subscription not found.");
		}
		const definition = await this.definitions.findOneBy({
			tenantId,
			code: input.definitionCode,
		});
		if (definition === null) {
			throw new NotFoundException("Entitlement definition not found.");
		}
		const problem = validateEntitlementValue(
			definition.valueType,
			input.value,
			definition.validationSchema,
		);
		if (problem !== null) {
			throw new UnprocessableEntityException(
				`Invalid entitlement value: ${problem}`,
			);
		}
		const effectiveUntil = input.effectiveUntil ?? null;
		if (
			effectiveUntil !== null &&
			effectiveUntil.getTime() <= input.effectiveFrom.getTime()
		) {
			throw new UnprocessableEntityException(
				"effectiveUntil must be after effectiveFrom.",
			);
		}

		const existing = await this.overrides.find({
			where: {
				tenantId,
				subscriptionId: subscription.id,
				entitlementDefinitionId: definition.id,
			},
		});
		const from = input.effectiveFrom.getTime();
		const until = effectiveUntil?.getTime() ?? Number.POSITIVE_INFINITY;
		const overlaps = existing.some((override) => {
			const otherFrom = override.effectiveFrom.getTime();
			const otherUntil =
				override.effectiveUntil?.getTime() ?? Number.POSITIVE_INFINITY;
			return otherUntil > from && otherFrom < until;
		});
		if (overlaps) {
			throw new ConflictException(
				"An override already exists for this entitlement and period.",
			);
		}

		return this.overrides.save(
			this.overrides.create({
				tenantId,
				subscriptionId: subscription.id,
				entitlementDefinitionId: definition.id,
				value: input.value,
				reason: input.reason,
				effectiveFrom: input.effectiveFrom,
				effectiveUntil,
				createdBy: identityId,
			}),
		);
	}
}
