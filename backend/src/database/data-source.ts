import "dotenv/config";
import { join } from "node:path";

import { DataSource } from "typeorm";

import { SnakeNamingStrategy } from "./snake-naming.strategy";

export const AppDataSource = new DataSource({
	type: "postgres",
	url: process.env.DATABASE_URL,
	entities: [join(__dirname, "..", "**", "*.entity.{ts,js}")],
	migrations: [join(__dirname, "migrations", "*.{ts,js}")],
	synchronize: false,
	namingStrategy: new SnakeNamingStrategy(),
	logging: process.env.NODE_ENV === "development",
});
