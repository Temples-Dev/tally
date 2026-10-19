import { join } from "node:path";

import type { ConfigService } from "@nestjs/config";
import type { TypeOrmModuleOptions } from "@nestjs/typeorm";

import { SnakeNamingStrategy } from "./snake-naming.strategy";

/** Shared TypeORM configuration for the API, worker, and integration tests. */
export function typeOrmOptions(
	configService: ConfigService,
): TypeOrmModuleOptions {
	return {
		type: "postgres",
		url: configService.get<string>("DATABASE_URL"),
		autoLoadEntities: true,
		synchronize: false,
		migrations: [join(__dirname, "migrations", "*.{ts,js}")],
		namingStrategy: new SnakeNamingStrategy(),
	};
}
