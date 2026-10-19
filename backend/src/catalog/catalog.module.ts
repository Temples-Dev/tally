import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { IdentityModule } from "../identity/identity.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { EntitlementDefinition } from "./entities/entitlement-definition.entity";
import { PlanEntitlement } from "./entities/plan-entitlement.entity";
import { PlanVersion } from "./entities/plan-version.entity";
import { Plan } from "./entities/plan.entity";
import { Product } from "./entities/product.entity";
import { UsageMetric } from "./entities/usage-metric.entity";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			Product,
			Plan,
			PlanVersion,
			UsageMetric,
			EntitlementDefinition,
			PlanEntitlement,
		]),
		SubscriptionsModule,
		IdentityModule,
	],
	controllers: [CatalogController],
	providers: [CatalogService],
})
export class CatalogModule {}
