import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function renderApp() {
	return render(
		<MemoryRouter>
			<App />
		</MemoryRouter>,
	);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("App", () => {
	it("renders the Tally heading", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					status: "ok",
					timestamp: new Date().toISOString(),
					uptime: 1,
					version: "0.1.0",
					services: [],
				}),
			}),
		);

		renderApp();

		expect(
			await screen.findByRole("heading", { name: "Tally" }),
		).toBeInTheDocument();
		expect(await screen.findByTestId("status-ok")).toBeInTheDocument();
	});

	it("shows an error state when the API is unreachable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("connection refused")),
		);

		renderApp();

		expect(await screen.findByTestId("status-error")).toBeInTheDocument();
		expect(screen.getByText("connection refused")).toBeInTheDocument();
	});
});
