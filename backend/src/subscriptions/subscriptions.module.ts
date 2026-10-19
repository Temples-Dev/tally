import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { EntitlementDefinition } from "../catalog/entities/entitlement-definition.entity";
import { PlanEntitlement } from "../catalog/entities/plan-entitlement.entity";
import { PlanVersion } from "../catalog/entities/plan-version.entity";
import { Plan } from "../catalog/entities/plan.entity";
import { Product } from "../catalog/entities/product.entity";
import { Tenant } from "../identity/entities/tenant.entity";
import { IdentityModule } from "../identity/identity.module";
import { CustomerAccount } from "./entities/customer-account.entity";
import { EntitlementOverride } from "./entities/entitlement-override.entity";
import { SubscriptionChange } from "./entities/subscription-change.entity";
import { Subscription } from "./entities/subscription.entity";
import { EntitlementsController } from "./entitlements.controller";
import { EntitlementsService } from "./entitlements.service";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			Tenant,
			CustomerAccount,
			Subscription,
			SubscriptionChange,
			Plan,
			Product,
			PlanVersion,
			PlanEntitlement,
			EntitlementDefinition,
			EntitlementOverride,
		]),
		IdentityModule,
	],
	controllers: [SubscriptionsController, EntitlementsController],
	providers: [SubscriptionsService, EntitlementsService],
	exports: [SubscriptionsService, EntitlementsService],
})
export class SubscriptionsModule {}
