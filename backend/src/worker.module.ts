import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { validateEnvironment } from "./config/environment.validation";
import { WorkerHealthModule } from "./worker/worker-health.module";

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
			}),
			inject: [ConfigService],
		}),
		WorkerHealthModule,
	],
})
export class WorkerModule {}
