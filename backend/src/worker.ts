import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { WorkerModule } from "./worker.module";

async function bootstrap() {
	const app = await NestFactory.createApplicationContext(WorkerModule, {
		logger: ["error", "warn", "log"],
	});

	const shutdown = (signal: string) => {
		Logger.log(`Received ${signal}, shutting down`, "Bootstrap");
		void app.close().then(() => process.exit(0));
	};
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	Logger.log("Worker started", "Bootstrap");
}

bootstrap().catch((error) => {
	Logger.error("Worker failed to start", error, "Bootstrap");
	process.exit(1);
});
