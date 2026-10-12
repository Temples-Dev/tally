import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	const configService = app.get(ConfigService);

	app.setGlobalPrefix("v1");
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

	const swaggerConfig = new DocumentBuilder()
		.setTitle("Tally API")
		.setDescription(
			"Metering-to-invoice infrastructure: usage ingestion, entitlements, subscriptions, billing, and invoices.",
		)
		.setVersion("v1")
		.build();
	const document = SwaggerModule.createDocument(app, swaggerConfig);
	SwaggerModule.setup("docs", app, document);

	const port = configService.get<number>("PORT", 3000);
	await app.listen(port);
	Logger.log(`API listening on :${port}`, "Bootstrap");
}

bootstrap().catch((error) => {
	Logger.error("API failed to start", error, "Bootstrap");
	process.exit(1);
});
