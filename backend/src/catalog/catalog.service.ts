import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";

import { isUniqueViolation } from "../common/database-errors";
import { EntitlementDefinition } from "./entities/entitlement-definition.entity";
import { PlanEntitlement } from "./entities/plan-entitlement.entity";
import { PlanVersion } from "./entities/plan-version.entity";
import { Plan } from "./entities/plan.entity";
import { Product } from "./entities/product.entity";
import { UsageMetric } from "./entities/usage-metric.entity";
import {
	type AggregationMethod,
	DefinitionStatus,
	type EntitlementValueType,
	PlanStatus,
	PlanVersionStatus,
} from "./enums";
import { validateEntitlementValue } from "./value-validation";

@Injectable()
export class CatalogService {
	constructor(
		@InjectRepository(Product) private readonly products: Repository<Product>,
		@InjectRepository(Plan) private readonly plans: Repository<Plan>,
		@InjectRepository(PlanVersion)
		private readonly versions: Repository<PlanVersion>,
		@InjectRepository(UsageMetric)
		private readonly meters: Repository<UsageMetric>,
		@InjectRepository(EntitlementDefinition)
		private readonly definitions: Repository<EntitlementDefinition>,
		@InjectRepository(PlanEntitlement)
		private readonly planEntitlements: Repository<PlanEntitlement>,
	) {}

	async createProduct(
		tenantId: string,
		input: { code: string; name: string; description?: string },
	): Promise<Product> {
		try {
			return await this.products.save(
				this.products.create({ tenantId, ...input }),
			);
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ConflictException("A product with this code already exists.");
			}
			throw error;
		}
	}

	listProducts(tenantId: string): Promise<Product[]> {
		return this.products.find({ where: { tenantId }, order: { code: "ASC" } });
	}

	async requireProduct(tenantId: string, id: string): Promise<Product> {
		const product = await this.products.findOneBy({ tenantId, id });
		if (product === null) {
			throw new NotFoundException("Product not found.");
		}
		return product;
	}

	async createPlan(
		tenantId: string,
		input: {
			productId: string;
			code: string;
			name: string;
			description?: string;
		},
	): Promise<Plan> {
		await this.requireProduct(tenantId, input.productId);
		try {
			return await this.plans.save(this.plans.create({ tenantId, ...input }));
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ConflictException(
					"A plan with this code already exists for the product.",
				);
			}
			throw error;
		}
	}

	listPlans(tenantId: string, productId?: string): Promise<Plan[]> {
		return this.plans.find({
			where: { tenantId, ...(productId === undefined ? {} : { productId }) },
			order: { code: "ASC" },
		});
	}

	async requirePlan(tenantId: string, id: string): Promise<Plan> {
		const plan = await this.plans.findOneBy({ tenantId, id });
		if (plan === null) {
			throw new NotFoundException("Plan not found.");
		}
		return plan;
	}

	async archivePlan(tenantId: string, id: string): Promise<Plan> {
		const plan = await this.requirePlan(tenantId, id);
		plan.status = PlanStatus.ARCHIVED;
		return this.plans.save(plan);
	}

	async createPlanVersion(
		tenantId: string,
		planId: string,
		input: { effectiveFrom?: Date; configuration?: Record<string, unknown> },
	): Promise<PlanVersion> {
		await this.requirePlan(tenantId, planId);
		const number = (await this.versions.countBy({ tenantId, planId })) + 1;
		try {
			return await this.versions.save(
				this.versions.create({
					tenantId,
					planId,
					versionNumber: number,
					effectiveFrom: input.effectiveFrom ?? new Date(),
					configuration: input.configuration ?? {},
				}),
			);
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ConflictException(
					"A version was created concurrently; retry the request.",
				);
			}
			throw error;
		}
	}

	listVersions(tenantId: string, planId: string): Promise<PlanVersion[]> {
		return this.versions.find({
			where: { tenantId, planId },
			order: { versionNumber: "ASC" },
		});
	}

	async requireVersion(
		tenantId: string,
		planId: string,
		versionId: string,
	): Promise<PlanVersion> {
		const version = await this.versions.findOneBy({
			tenantId,
			planId,
			id: versionId,
		});
		if (version === null) {
			throw new NotFoundException("Plan version not found.");
		}
		return version;
	}

	async publishVersion(
		tenantId: string,
		planId: string,
		versionId: string,
		effectiveFrom?: Date,
	): Promise<PlanVersion> {
		const version = await this.requireVersion(tenantId, planId, versionId);
		if (version.status !== PlanVersionStatus.DRAFT) {
			throw new ConflictException("Only draft versions can be published.");
		}
		if (effectiveFrom !== undefined) {
			version.effectiveFrom = effectiveFrom;
		}
		await this.rejectOverlappingPublished(version);
		version.status = PlanVersionStatus.PUBLISHED;
		version.publishedAt = new Date();
		const saved = await this.versions.save(version);
		await this.versions
			.createQueryBuilder()
			.update()
			.set({ effectiveUntil: version.effectiveFrom })
			.where("tenantId = :tenantId", { tenantId })
			.andWhere("planId = :planId", { planId })
			.andWhere("status = :status", { status: PlanVersionStatus.PUBLISHED })
			.andWhere("id != :id", { id: version.id })
			.andWhere("(effectiveUntil IS NULL OR effectiveUntil > :from)", {
				from: version.effectiveFrom,
			})
			.execute();
		const plan = await this.requirePlan(tenantId, planId);
		if (plan.status === PlanStatus.DRAFT) {
			plan.status = PlanStatus.PUBLISHED;
			await this.plans.save(plan);
		}
		return saved;
	}

	private async rejectOverlappingPublished(
		candidate: PlanVersion,
	): Promise<void> {
		const published = await this.versions.findBy({
			tenantId: candidate.tenantId,
			planId: candidate.planId,
			status: PlanVersionStatus.PUBLISHED,
		});
		const candidateEnd = candidate.effectiveUntil ?? new Date(8640000000000000);
		const overlap = published.some((other) => {
			if (other.id === candidate.id) {
				return false;
			}
			const otherEnd = other.effectiveUntil ?? new Date(8640000000000000);
			if (other.effectiveUntil === null) {
				// Publishing closes the open-ended version at the candidate's start,
				// so overlap only exists for a candidate that starts at or before it.
				return (
					candidate.effectiveFrom <= other.effectiveFrom &&
					candidateEnd > other.effectiveFrom
				);
			}
			return (
				candidate.effectiveFrom < otherEnd && other.effectiveFrom < candidateEnd
			);
		});
		if (overlap) {
			throw new ConflictException(
				"The effective period overlaps a published version.",
			);
		}
	}

	async setPlanEntitlement(
		tenantId: string,
		planId: string,
		versionId: string,
		definitionCode: string,
		value: unknown,
	): Promise<PlanEntitlement> {
		const version = await this.requireVersion(tenantId, planId, versionId);
		if (version.status !== PlanVersionStatus.DRAFT) {
			throw new ConflictException(
				"Entitlements cannot be edited on a published version.",
			);
		}
		const definition = await this.definitions.findOneBy({
			tenantId,
			code: definitionCode,
		});
		if (definition === null || definition.status !== DefinitionStatus.ACTIVE) {
			throw new NotFoundException("Entitlement definition not found.");
		}
		const problem = validateEntitlementValue(
			definition.valueType,
			value,
			definition.validationSchema,
		);
		if (problem !== null) {
			throw new UnprocessableEntityException(
				`Invalid entitlement value: ${problem}`,
			);
		}
		const existing = await this.planEntitlements.findOneBy({
			tenantId,
			planVersionId: version.id,
			entitlementDefinitionId: definition.id,
		});
		if (existing === null) {
			return this.planEntitlements.save(
				this.planEntitlements.create({
					tenantId,
					planVersionId: version.id,
					entitlementDefinitionId: definition.id,
					value,
				}),
			);
		}
		existing.value = value;
		return this.planEntitlements.save(existing);
	}

	async createMeter(
		tenantId: string,
		input: {
			code: string;
			name: string;
			unit: string;
			aggregationMethod?: AggregationMethod;
			allowsNegative?: boolean;
			maxEventAgeSeconds?: number | null;
			maxFutureSkewSeconds?: number;
			allowedDimensions?: string[] | null;
		},
	): Promise<UsageMetric> {
		try {
			return await this.meters.save(this.meters.create({ tenantId, ...input }));
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ConflictException("A meter with this code already exists.");
			}
			throw error;
		}
	}

	listMeters(tenantId: string): Promise<UsageMetric[]> {
		return this.meters.find({ where: { tenantId }, order: { code: "ASC" } });
	}

	async createDefinition(
		tenantId: string,
		input: {
			code: string;
			name: string;
			description?: string;
			valueType: EntitlementValueType;
			defaultValue?: unknown;
			validationSchema?: Record<string, unknown>;
		},
	): Promise<EntitlementDefinition> {
		const problem =
			input.defaultValue === undefined
				? null
				: validateEntitlementValue(
						input.valueType,
						input.defaultValue,
						input.validationSchema,
					);
		if (problem !== null) {
			throw new UnprocessableEntityException(
				`Invalid default value: ${problem}`,
			);
		}
		try {
			return await this.definitions.save(
				this.definitions.create({ tenantId, ...input }),
			);
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ConflictException(
					"An entitlement definition with this code already exists.",
				);
			}
			throw error;
		}
	}

	listDefinitions(tenantId: string): Promise<EntitlementDefinition[]> {
		return this.definitions.find({
			where: { tenantId },
			order: { code: "ASC" },
		});
	}
}
