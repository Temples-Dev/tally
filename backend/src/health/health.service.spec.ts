import type { DataSource } from "typeorm";

import { HealthService } from "./health.service";

describe("HealthService", () => {
	let service: HealthService;
	let dataSource: jest.Mocked<DataSource>;

	beforeEach(() => {
		dataSource = {
			query: jest.fn(),
		} as unknown as jest.Mocked<DataSource>;
		service = new HealthService(dataSource);
	});

	it("reports ok when the database responds", async () => {
		dataSource.query.mockResolvedValue([{ "?column?": 1 }]);

		const result = await service.check();

		expect(result.status).toBe("ok");
		expect(result.services).toEqual([
			expect.objectContaining({ name: "postgresql", status: "healthy" }),
		]);
	});

	it("reports error when the database is unreachable", async () => {
		dataSource.query.mockRejectedValue(new Error("connection refused"));

		const result = await service.check();

		expect(result.status).toBe("error");
		expect(result.services).toEqual([
			expect.objectContaining({
				name: "postgresql",
				status: "unhealthy",
				details: "connection refused",
			}),
		]);
	});

	it("isReady reflects database health", async () => {
		dataSource.query.mockResolvedValueOnce([{ "?column?": 1 }]);
		await expect(service.isReady()).resolves.toBe(true);

		dataSource.query.mockRejectedValueOnce(new Error("down"));
		await expect(service.isReady()).resolves.toBe(false);
	});
});
