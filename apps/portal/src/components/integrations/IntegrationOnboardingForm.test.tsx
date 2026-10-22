import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

try {
	GlobalRegistrator.register({ url: "http://localhost:5601/" });
} catch {}

const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useBlocker: () => {},
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { IntegrationOnboardingForm } = await import("./IntegrationOnboardingForm");
const { integrationService } = await import("@/services/integrations");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const wrap = (node: ReactNode) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{node}
		</QueryClientProvider>,
	);

test("IntegrationOnboardingForm renders plugin variant card with Plugin badge", async () => {
	spyOn(integrationService, "getVariants").mockResolvedValue([
		{
			group: "crm",
			label: "CRM",
			builtIn: false,
			variants: [
				{
					variant: "HubSpot",
					label: "HubSpot",
					builtIn: false,
					plugin: { id: "pl-1", name: "acme/crm", namespace: "acme" },
				},
			],
		},
	] as any);

	wrap(
		<IntegrationOnboardingForm projectId="p1" group="crm" onSelect={() => {}} onSaved={() => {}} />,
	);

	await act(async () => new Promise((r) => setTimeout(r, 50)));

	// Step 2 shows the provider
	expect(document.body.textContent).toContain("HubSpot");
	const badge = within(document.body).getByText("Plugin");
	expect(badge).toBeTruthy();
});

test("IntegrationOnboardingForm displays test connection error text verbatim", async () => {
	spyOn(integrationService, "getVariants").mockResolvedValue([
		{
			group: "database",
			label: "Databases",
			builtIn: true,
			variants: [
				{
					variant: "CockroachDB",
					label: "CockroachDB",
					builtIn: false,
					plugin: { id: "pl-1", name: "acme/cockroach", namespace: "acme" },
				},
			],
		},
	] as any);

	spyOn(integrationService, "testConnection").mockRejectedValue(
		new Error("Worker connection timeout after 5000ms: acme/cockroach unavailable"),
	);

	wrap(
		<IntegrationOnboardingForm
			projectId="p1"
			group="database"
			variant="CockroachDB"
			onSelect={() => {}}
			onSaved={() => {}}
		/>,
	);

	await act(async () => new Promise((r) => setTimeout(r, 50)));

	expect(document.body.textContent).toContain("Configure CockroachDB");
	// Turn on Same as production so test does not bail on empty dev config
	const syncDevCheckbox = within(document.body).getByLabelText("Same as production");
	await act(async () => void fireEvent.click(syncDevCheckbox));

	const testBtn = within(document.body).getByRole("button", { name: /Test connection/i });
	await act(async () => void fireEvent.click(testBtn));

	await act(async () => new Promise((r) => setTimeout(r, 50)));

	expect(document.body.textContent).toContain(
		"Worker connection timeout after 5000ms: acme/cockroach unavailable",
	);
});
