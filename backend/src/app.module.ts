import {
	type MiddlewareConsumer,
	Module,
	type NestModule,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";

import { CatalogModule } from "./catalog/catalog.module";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { ProblemDetailsFilter } from "./common/problem-details.filter";
import { validateEnvironment } from "./config/environment.validation";
import { typeOrmOptions } from "./database/typeorm-options";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { JwtAuthGuard } from "./identity/jwt-auth.guard";
import { QuotasModule } from "./quotas/quotas.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { UsageModule } from "./usage/usage.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validate: validateEnvironment,
		}),
		TypeOrmModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: typeOrmOptions,
			inject: [ConfigService],
		}),
		HealthModule,
		IdentityModule,
		CatalogModule,
		SubscriptionsModule,
		UsageModule,
		QuotasModule,
	],
	providers: [
		{ provide: APP_GUARD, useClass: JwtAuthGuard },
		{ provide: APP_FILTER, useClass: ProblemDetailsFilter },
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer): void {
		consumer.apply(CorrelationIdMiddleware).forRoutes("*");
	}
}
