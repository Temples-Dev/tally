import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { configureApp } from "./app-setup";
import { AppModule } from "./app.module";

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	configureApp(app);

	const swaggerConfig = new DocumentBuilder()
		.setTitle("Tally API")
		.setDescription(
			"Metering-to-invoice infrastructure: usage ingestion, entitlements, subscriptions, billing, and invoices.",
		)
		.setVersion("v1")
		.build();
	const document = SwaggerModule.createDocument(app, swaggerConfig);
	SwaggerModule.setup("docs", app, document);

	const configService = app.get(ConfigService);
	const port = configService.get<number>("PORT", 3000);
	await app.listen(port);
	Logger.log(`API listening on :${port}`, "Bootstrap");
}

bootstrap().catch((error) => {
	Logger.error("API failed to start", error, "Bootstrap");
	process.exit(1);
});
