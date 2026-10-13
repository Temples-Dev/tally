import { Injectable, ServiceUnavailableException } from "@nestjs/common";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";

export interface DependencyStatus {
	name: string;
	status: "healthy" | "unhealthy";
	lastChecked: string;
	responseTime?: number;
	details?: string;
}

export interface HealthStatus {
	status: "ok" | "error";
	timestamp: string;
	uptime: number;
	version: string;
	services: DependencyStatus[];
}

@Injectable()
export class HealthService {
	private readonly startTime = Date.now();

	constructor(private readonly dataSource: DataSource) {}

	async check(): Promise<HealthStatus> {
		const services = [await this.checkDatabase()];
		const unhealthy = services.some((s) => s.status === "unhealthy");

		return {
			status: unhealthy ? "error" : "ok",
			timestamp: new Date().toISOString(),
			uptime: Date.now() - this.startTime,
			version: process.env.npm_package_version ?? "0.1.0",
			services,
		};
	}

	async isReady(): Promise<boolean> {
		const [database] = await Promise.all([this.checkDatabase()]);
		return database.status === "healthy";
	}

	private async checkDatabase(): Promise<DependencyStatus> {
		const lastChecked = new Date().toISOString();
		try {
			const start = Date.now();
			await this.dataSource.query("SELECT 1");
			return {
				name: "postgresql",
				status: "healthy",
				lastChecked,
				responseTime: Date.now() - start,
			};
		} catch (error) {
			return {
				name: "postgresql",
				status: "unhealthy",
				lastChecked,
				details: error instanceof Error ? error.message : String(error),
			};
		}
	}

	assertReady(): void {
		if (!this.isReady()) {
			throw new ServiceUnavailableException("Service is not ready");
		}
	}
}
