import {
	ConflictException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";
import type { EntityManager, Repository } from "typeorm";

import { PlanVersion } from "../catalog/entities/plan-version.entity";
import { Plan } from "../catalog/entities/plan.entity";
import { PlanStatus, PlanVersionStatus } from "../catalog/enums";
import { isUniqueViolation } from "../common/database-errors";
import { CustomerAccount } from "./entities/customer-account.entity";
import { SubscriptionChange } from "./entities/subscription-change.entity";
import { Subscription } from "./entities/subscription.entity";
import {
	CancelMode,
	ChangeStatus,
	ChangeType,
	EffectiveMode,
	SubscriptionStatus,
} from "./enums";
import { canTransition, changeTypeFor } from "./lifecycle";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionsService {
	constructor(
		private readonly dataSource: DataSource,
		@InjectRepository(Subscription)
		private readonly subscriptions: Repository<Subscription>,
		@InjectRepository(SubscriptionChange)
		private readonly changes: Repository<SubscriptionChange>,
		@InjectRepository(CustomerAccount)
		private readonly customers: Repository<CustomerAccount>,
		@InjectRepository(PlanVersion)
		private readonly versions: Repository<PlanVersion>,
		@InjectRepository(Plan)
		private readonly plans: Repository<Plan>,
	) {}

	async createCustomer(
		tenantId: string,
		input: {
			displayName: string;
			email?: string;
			externalCustomerRef?: string;
		},
	): Promise<CustomerAccount> {
		try {
			return await this.customers.save(
				this.customers.create({ tenantId, ...input }),
			);
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ConflictException(
					"A customer with this external reference already exists.",
				);
			}
			throw error;
		}
	}

	listCustomers(tenantId: string): Promise<CustomerAccount[]> {
		return this.customers.find({
			where: { tenantId },
			order: { displayName: "ASC" },
		});
	}

	async requireCustomer(
		tenantId: string,
		id: string,
	): Promise<CustomerAccount> {
		const customer = await this.customers.findOneBy({ tenantId, id });
		if (customer === null) {
			throw new NotFoundException("Customer account not found.");
		}
		return customer;
	}

	async createSubscription(
		tenantId: string,
		identityId: string,
		input: {
			customerAccountId: string;
			planVersionId: string;
			trialDays?: number;
		},
	): Promise<Subscription> {
		await this.requireCustomer(tenantId, input.customerAccountId);
		const trialDays = input.trialDays ?? 0;
		if (trialDays < 0) {
			throw new UnprocessableEntityException("Trial days cannot be negative.");
		}
		const now = new Date();
		const { version, plan } = await this.requireSubscribableVersion(
			tenantId,
			input.planVersionId,
			now,
		);

		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(Subscription);
			const subscription = repository.create({
				tenantId,
				customerAccountId: input.customerAccountId,
				productId: plan.productId,
				planVersionId: version.id,
				status:
					trialDays > 0
						? SubscriptionStatus.TRIALING
						: SubscriptionStatus.ACTIVE,
				startedAt: now,
				currentPeriodStart: now,
				currentPeriodEnd: new Date(now.getTime() + THIRTY_DAYS_MS),
				trialEndsAt:
					trialDays > 0
						? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)
						: null,
			});
			const saved = await this.saveSubscription(repository, subscription);
			await this.recordChange(
				manager,
				saved,
				ChangeType.CREATED,
				now,
				now,
				identityId,
				null,
				{},
				{ status: saved.status },
			);
			return saved;
		});
	}

	async requireSubscription(
		tenantId: string,
		id: string,
	): Promise<Subscription> {
		const subscription = await this.subscriptions.findOneBy({ tenantId, id });
		if (subscription === null) {
			throw new NotFoundException("Subscription not found.");
		}
		return subscription;
	}

	listSubscriptions(tenantId: string): Promise<Subscription[]> {
		return this.subscriptions.find({
			where: { tenantId },
			order: { createdAt: "DESC" },
		});
	}

	async transition(
		tenantId: string,
		id: string,
		to: SubscriptionStatus,
		identityId: string,
		reason: string | null = null,
	): Promise<Subscription> {
		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(Subscription);
			const subscription = await repository.findOneBy({ tenantId, id });
			if (subscription === null) {
				throw new NotFoundException("Subscription not found.");
			}
			return this.applyTransition(
				manager,
				repository,
				subscription,
				to,
				identityId,
				reason,
			);
		});
	}

	async cancel(
		tenantId: string,
		id: string,
		mode: CancelMode,
		identityId: string,
		reason: string | null,
	): Promise<Subscription> {
		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(Subscription);
			const subscription = await repository.findOneBy({ tenantId, id });
			if (subscription === null) {
				throw new NotFoundException("Subscription not found.");
			}
			const now = new Date();

			if (
				subscription.status === SubscriptionStatus.PENDING ||
				subscription.status === SubscriptionStatus.TRIALING
			) {
				if (mode !== CancelMode.IMMEDIATE) {
					throw new ConflictException(
						"A pending or trialing subscription can only cancel immediately.",
					);
				}
				subscription.cancelledAt = now;
				return this.applyTransition(
					manager,
					repository,
					subscription,
					SubscriptionStatus.CANCELLED,
					identityId,
					reason,
				);
			}

			if (
				subscription.status !== SubscriptionStatus.ACTIVE &&
				subscription.status !== SubscriptionStatus.PAST_DUE &&
				subscription.status !== SubscriptionStatus.PAUSED
			) {
				throw new ConflictException(
					`Cannot cancel a ${subscription.status} subscription.`,
				);
			}

			if (mode === CancelMode.IMMEDIATE) {
				subscription.cancelledAt = now;
				return this.applyTransition(
					manager,
					repository,
					subscription,
					SubscriptionStatus.CANCELLED,
					identityId,
					reason,
				);
			}

			if (subscription.cancelAtPeriodEnd) {
				throw new ConflictException(
					"This subscription is already scheduled to cancel.",
				);
			}
			subscription.cancelAtPeriodEnd = true;
			const saved = await this.saveSubscription(repository, subscription);
			await this.recordChange(
				manager,
				saved,
				ChangeType.CANCEL_REQUESTED,
				subscription.currentPeriodEnd ?? now,
				now,
				identityId,
				reason,
				{ cancelAtPeriodEnd: false },
				{ cancelAtPeriodEnd: true },
			);
			return saved;
		});
	}

	async resume(
		tenantId: string,
		id: string,
		identityId: string,
	): Promise<Subscription> {
		const subscription = await this.requireSubscription(tenantId, id);
		if (
			subscription.status !== SubscriptionStatus.PAUSED &&
			subscription.status !== SubscriptionStatus.TRIALING &&
			subscription.status !== SubscriptionStatus.PAST_DUE
		) {
			throw new ConflictException(
				`Cannot resume a ${subscription.status} subscription.`,
			);
		}
		return this.transition(
			tenantId,
			id,
			SubscriptionStatus.ACTIVE,
			identityId,
			null,
		);
	}

	async requestPlanChange(
		tenantId: string,
		id: string,
		targetPlanVersionId: string,
		effectiveMode: EffectiveMode,
		identityId: string,
	): Promise<Subscription> {
		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(Subscription);
			const subscription = await repository.findOneBy({ tenantId, id });
			if (subscription === null) {
				throw new NotFoundException("Subscription not found.");
			}
			if (
				subscription.status !== SubscriptionStatus.ACTIVE &&
				subscription.status !== SubscriptionStatus.TRIALING
			) {
				throw new ConflictException(
					"Plan changes require an active or trialing subscription.",
				);
			}
			const now = new Date();
			const { version: target, plan } = await this.requireSubscribableVersion(
				tenantId,
				targetPlanVersionId,
				now,
			);
			if (plan.productId !== subscription.productId) {
				throw new UnprocessableEntityException(
					"Plan changes must stay within the subscription's product.",
				);
			}
			if (target.id === subscription.planVersionId) {
				throw new ConflictException(
					"The subscription is already on this plan version.",
				);
			}

			if (effectiveMode === EffectiveMode.IMMEDIATE) {
				const previous = { planVersionId: subscription.planVersionId };
				subscription.planVersionId = target.id;
				const saved = await this.saveSubscription(repository, subscription);
				await this.recordChange(
					manager,
					saved,
					ChangeType.PLAN_CHANGE_APPLIED,
					now,
					now,
					identityId,
					null,
					previous,
					{ planVersionId: target.id },
				);
				return saved;
			}

			const effectiveAt =
				subscription.currentPeriodEnd ??
				new Date(now.getTime() + THIRTY_DAYS_MS);
			await this.recordChange(
				manager,
				subscription,
				ChangeType.PLAN_CHANGE_REQUESTED,
				effectiveAt,
				now,
				identityId,
				null,
				{ planVersionId: subscription.planVersionId },
				{ planVersionId: target.id },
				ChangeStatus.PENDING,
			);
			return subscription;
		});
	}

	history(tenantId: string, id: string): Promise<SubscriptionChange[]> {
		return this.changes.find({
			where: { tenantId, subscriptionId: id },
			order: { effectiveAt: "DESC", createdAt: "DESC" },
		});
	}

	countLiveSubscriptions(
		tenantId: string,
		versionIds?: string[],
	): Promise<number> {
		const query = this.subscriptions
			.createQueryBuilder("subscription")
			.where("subscription.tenantId = :tenantId", { tenantId })
			.andWhere("subscription.status NOT IN (:...terminal)", {
				terminal: [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED],
			});
		if (versionIds !== undefined) {
			query.andWhere("subscription.planVersionId IN (:...versionIds)", {
				versionIds,
			});
		}
		return query.getCount();
	}

	async assertNoLiveSubscriptions(
		tenantId: string,
		versionIds: string[],
	): Promise<void> {
		const live = await this.countLiveSubscriptions(tenantId, versionIds);
		if (live > 0) {
			throw new ConflictException(
				"A plan with live subscriptions cannot be archived.",
			);
		}
	}

	private async requireSubscribableVersion(
		tenantId: string,
		planVersionId: string,
		at: Date,
	): Promise<{ version: PlanVersion; plan: Plan }> {
		const version = await this.versions.findOneBy({
			tenantId,
			id: planVersionId,
		});
		if (version === null || version.status !== PlanVersionStatus.PUBLISHED) {
			throw new UnprocessableEntityException(
				"The plan version is not published.",
			);
		}
		const plan = await this.plans.findOneBy({ tenantId, id: version.planId });
		if (plan === null || plan.status !== PlanStatus.PUBLISHED) {
			throw new UnprocessableEntityException("The plan is not published.");
		}
		if (version.effectiveFrom.getTime() > at.getTime()) {
			throw new UnprocessableEntityException(
				"The plan version is not yet effective.",
			);
		}
		if (
			version.effectiveUntil !== null &&
			version.effectiveUntil.getTime() <= at.getTime()
		) {
			throw new UnprocessableEntityException(
				"The plan version is no longer effective.",
			);
		}
		return { version, plan };
	}

	private async applyTransition(
		manager: EntityManager,
		repository: Repository<Subscription>,
		subscription: Subscription,
		to: SubscriptionStatus,
		identityId: string,
		reason: string | null,
	): Promise<Subscription> {
		if (!canTransition(subscription.status, to)) {
			throw new ConflictException(
				`Cannot move a subscription from ${subscription.status} to ${to}.`,
			);
		}
		const from = subscription.status;
		const now = new Date();
		subscription.status = to;
		const saved = await this.saveSubscription(repository, subscription);
		await this.recordChange(
			manager,
			saved,
			changeTypeFor(from, to),
			now,
			now,
			identityId,
			reason,
			{ status: from },
			{ status: to },
		);
		return saved;
	}

	private async saveSubscription(
		repository: Repository<Subscription>,
		subscription: Subscription,
	): Promise<Subscription> {
		try {
			return await repository.save(subscription);
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ConflictException(
					"The tenant already has an active or trialing subscription for this product.",
				);
			}
			throw error;
		}
	}

	private async recordChange(
		manager: EntityManager,
		subscription: Subscription,
		changeType: ChangeType,
		effectiveAt: Date,
		appliedAt: Date | null,
		actorId: string | null,
		reason: string | null,
		previous: Record<string, unknown>,
		next: Record<string, unknown>,
		status: ChangeStatus = ChangeStatus.APPLIED,
	): Promise<void> {
		const repository = manager.getRepository(SubscriptionChange);
		await repository.save(
			repository.create({
				tenantId: subscription.tenantId,
				subscriptionId: subscription.id,
				changeType,
				effectiveAt,
				previousConfiguration: previous,
				newConfiguration: next,
				status,
				appliedAt,
				actorId,
				reason,
			}),
		);
	}
}
