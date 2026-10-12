import { useEffect, useState } from "react";

interface DependencyStatus {
	name: string;
	status: "healthy" | "unhealthy";
	responseTime?: number;
}

interface HealthStatus {
	status: "ok" | "error";
	timestamp: string;
	uptime: number;
	version: string;
	services: DependencyStatus[];
}

type LoadState =
	| { kind: "loading" }
	| { kind: "ready"; health: HealthStatus }
	| { kind: "error"; message: string };

export function HomePage() {
	const [state, setState] = useState<LoadState>({ kind: "loading" });

	useEffect(() => {
		const controller = new AbortController();

		fetch("/health", { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`API returned ${response.status}`);
				}
				const health = (await response.json()) as HealthStatus;
				setState({ kind: "ready", health });
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) {
					return;
				}
				setState({
					kind: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			});

		return () => controller.abort();
	}, []);

	return (
		<main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
			<header className="mb-10">
				<h1 className="font-bold text-4xl text-gray-900 tracking-tight">
					Tally
				</h1>
				<p className="mt-2 text-gray-600 text-lg">
					Metering-to-invoice infrastructure for SaaS.
				</p>
			</header>

			<section className="rounded-lg border border-gray-200 p-6">
				<h2 className="font-semibold text-gray-500 text-sm uppercase tracking-wide">
					Platform status
				</h2>
				<div className="mt-4">
					{state.kind === "loading" && (
						<p data-testid="status-loading" className="text-gray-500">
							Checking API…
						</p>
					)}
					{state.kind === "error" && (
						<div data-testid="status-error">
							<p className="font-medium text-red-600">API unreachable</p>
							<p className="mt-1 text-gray-500 text-sm">{state.message}</p>
						</div>
					)}
					{state.kind === "ready" && (
						<div data-testid="status-ok">
							<p className="font-medium text-tally-600">
								API {state.health.status === "ok" ? "operational" : "degraded"}{" "}
								· v{state.health.version}
							</p>
							<ul className="mt-3 space-y-1 text-gray-600 text-sm">
								{state.health.services.map((service) => (
									<li key={service.name} className="flex justify-between">
										<span>{service.name}</span>
										<span
											className={
												service.status === "healthy"
													? "text-tally-600"
													: "text-red-600"
											}
										>
											{service.status}
											{service.responseTime !== undefined
												? ` (${service.responseTime}ms)`
												: ""}
										</span>
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			</section>

			<footer className="mt-10 text-gray-400 text-sm">
				<a
					href="/docs"
					className="underline underline-offset-2 hover:text-gray-600"
				>
					API docs
				</a>
			</footer>
		</main>
	);
}
