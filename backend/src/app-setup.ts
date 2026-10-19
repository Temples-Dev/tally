import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export const API_PREFIX = "v1";

/**
 * Applies the request-handling configuration shared by the production
 * bootstrap and the integration test harness. Keeping it here guarantees the
 * tests exercise the same prefix, validation, and CORS behaviour as production.
 */
export function configureApp(app: INestApplication): void {
	const configService = app.get(ConfigService);

	app.setGlobalPrefix(API_PREFIX);
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		}),
	);
	app.enableCors({
		origin: configService.get<string>("CORS_ORIGINS", "").split(","),
		credentials: true,
	});
}
