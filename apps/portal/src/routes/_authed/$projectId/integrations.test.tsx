import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

try {
	GlobalRegistrator.register({ url: "http://localhost:5601/" });
} catch {}

const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => mock(),
	useBlocker: () => {},
	createFileRoute: () => (config: any) => ({
		...config,
		useParams: () => ({ projectId: "p1" }),
		useSearch: () => ({ group: "database" }),
	}),
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { IntegrationsPage, IntegrationsList } = await import("./integrations");
const { integrationService } = await import("@/services/integrations");
const { projectsService } = await import("@/services/projects");

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

test("integrations sidebar renders built-in groups with plugin variants and namespace groups", async () => {
	spyOn(projectsService, "getById").mockResolvedValue({ id: "p1", name: "My Project" } as any);
	spyOn(integrationService, "getVariants").mockResolvedValue([
		{
			group: "database",
			label: "Databases",
			builtIn: true,
			variants: [
				{ variant: "PostgreSQL", label: "PostgreSQL", builtIn: true },
				{
					variant: "CockroachDB",
					label: "CockroachDB",
					builtIn: false,
					plugin: { id: "pl-1", name: "acme/cockroach", namespace: "acme", icon: "data:img" },
				},
			],
		},
		{
			group: "crm",
			label: "CRM",
			builtIn: false,
			variants: [
				{
					variant: "HubSpot",
					label: "HubSpot",
					builtIn: false,
					plugin: { id: "pl-2", name: "acme/crm", namespace: "acme", icon: "data:crm" },
				},
			],
		},
	] as any);
	spyOn(integrationService, "getBasicList").mockResolvedValue([
		{
			id: "int-1",
			name: "Prod Postgres",
			group: "database",
			variant: "PostgreSQL",
			hasDevConfig: false,
			syncDev: true,
		},
		{
			id: "int-2",
			name: "Cockroach Cluster",
			group: "database",
			variant: "CockroachDB",
			hasDevConfig: false,
			syncDev: true,
		},
	]);
	spyOn(integrationService, "getAll").mockResolvedValue([
		{
			id: "int-1",
			name: "Prod Postgres",
			group: "database",
			variant: "PostgreSQL",
			config: {},
			devConfig: null,
			syncDev: true,
		},
	]);

	wrap(<IntegrationsPage />);

	await act(async () => new Promise((r) => setTimeout(r, 60)));

	// Built-in categories
	expect(document.body.textContent).toContain("Databases");
	expect(document.body.textContent).toContain("KV");

	// Plugin variant under built-in group
	expect(document.body.textContent).toContain("CockroachDB");
	const pluginBadges = within(document.body).getAllByText("Plugin");
	expect(pluginBadges.length).toBeGreaterThanOrEqual(1);

	// Plugin-owned group under namespace
	expect(document.body.textContent).toContain("PLUGIN INTEGRATIONS");
	expect(document.body.textContent).toContain("acme");
	expect(document.body.textContent).toContain("CRM");
	expect(document.body.textContent).toContain("HubSpot");
});

test("IntegrationsList marks existing integrations whose variant is disabled as plugin disabled", async () => {
	spyOn(integrationService, "getVariants").mockResolvedValue([
		{
			group: "database",
			label: "Databases",
			builtIn: true,
			variants: [{ variant: "PostgreSQL", label: "PostgreSQL", builtIn: true }],
		},
	] as any);
	spyOn(integrationService, "getAll").mockResolvedValue([
		{
			id: "int-1",
			name: "Prod Postgres",
			group: "database",
			variant: "PostgreSQL",
			config: {},
			devConfig: null,
			syncDev: true,
		},
		// int-2 was created with a plugin variant that is no longer in catalog (disabled)
		{
			id: "int-2",
			name: "Old Custom DB",
			group: "database",
			variant: "DisabledVariant",
			config: {},
			devConfig: null,
			syncDev: true,
		},
	]);

	wrap(<IntegrationsList projectId="p1" group="database" />);

	await act(async () => new Promise((r) => setTimeout(r, 60)));

	expect(document.body.textContent).toContain("Prod Postgres");
	expect(document.body.textContent).toContain("Old Custom DB");
	expect(document.body.textContent).toContain("plugin disabled");
});

test("IntegrationsList shows a plugin variant's own icon, and the group's when the image fails (#977)", async () => {
	const icon = "data:image/svg+xml;base64,PHN2Zy8+";
	spyOn(integrationService, "getVariants").mockResolvedValue([
		{
			group: "acme/crm",
			label: "acme/crm",
			builtIn: false,
			variants: [
				{ variant: "HubSpot", label: "HubSpot", builtIn: false, plugin: "acme/crm", icon },
			],
		},
	] as any);
	spyOn(integrationService, "getAll").mockResolvedValue([
		{
			id: "int-1",
			name: "Sales CRM",
			group: "acme/crm",
			variant: "HubSpot",
			config: {},
			devConfig: null,
			syncDev: true,
		},
	]);

	wrap(<IntegrationsList projectId="p1" group="acme/crm" />);
	await act(async () => new Promise((r) => setTimeout(r, 60)));

	const img = document.querySelector("tbody img");
	expect(img?.getAttribute("src")).toBe(icon);
	fireEvent.error(img!);
	expect(document.querySelector("tbody img")).toBeNull();
	expect(document.querySelector("tbody svg")).not.toBeNull();
});
