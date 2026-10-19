import { join } from "node:path";

import {
	type MiddlewareConsumer,
	Module,
	type NestModule,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SnakeNamingStrategy } from "./database/snake-naming.strategy";

import { CatalogModule } from "./catalog/catalog.module";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { ProblemDetailsFilter } from "./common/problem-details.filter";
import { validateEnvironment } from "./config/environment.validation";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { JwtAuthGuard } from "./identity/jwt-auth.guard";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validate: validateEnvironment,
		}),
		TypeOrmModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: (configService: ConfigService) => ({
				type: "postgres" as const,
				url: configService.get<string>("DATABASE_URL"),
				autoLoadEntities: true,
				synchronize: false,
				migrations: [join(__dirname, "database", "migrations", "*.{ts,js}")],
				namingStrategy: new SnakeNamingStrategy(),
			}),
			inject: [ConfigService],
		}),
		HealthModule,
		IdentityModule,
		CatalogModule,
		SubscriptionsModule,
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
