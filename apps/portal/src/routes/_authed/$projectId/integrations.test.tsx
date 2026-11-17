import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

try {
	GlobalRegistrator.register({ url: "http://localhost:5601/" });
} catch {}

let search: { group?: string } = {};
const navigate = mock();
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
	useBlocker: () => {},
	createFileRoute: () => (config: any) => ({
		...config,
		useParams: () => ({ projectId: "p1" }),
		useSearch: () => search,
	}),
	Link: ({ children, params: _p, ...rest }: { children: ReactNode; params?: unknown }) => (
		<a {...rest}>{children}</a>
	),
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { IntegrationsPage } = await import("./integrations");
const { integrationService } = await import("@/services/integrations");
const { projectsService } = await import("@/services/projects");

afterEach(() => {
	cleanup();
	search = {};
	navigate.mockClear();
});
afterAll(() => GlobalRegistrator.unregister());

const wrap = (node: ReactNode) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{node}
		</QueryClientProvider>,
	);

const row = (id: string, name: string, group: string, variant: string) => ({
	id,
	name,
	group,
	variant,
	hasDevConfig: false,
	syncDev: true,
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 60)));

function mockData(icon?: string) {
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
					plugin: "acme/cockroach",
					namespace: "acme",
				},
			],
		},
		{ group: "kv", label: "KV", builtIn: true, variants: [] },
		{
			group: "acme/crm",
			label: "CRM",
			builtIn: false,
			variants: [
				{ variant: "HubSpot", label: "HubSpot", builtIn: false, plugin: "acme/crm", icon },
			],
		},
	] as any);
	spyOn(integrationService, "getBasicList").mockResolvedValue([
		row("int-1", "Prod Postgres", "database", "PostgreSQL"),
		row("int-2", "Old Custom DB", "database", "DisabledVariant"),
		row("int-3", "Sales CRM", "acme/crm", "HubSpot"),
	]);
}

test("shows every integration as a row with its type and category, with one filter chip per category", async () => {
	mockData();
	wrap(<IntegrationsPage />);
	await settle();

	const body = within(document.body);
	for (const name of ["Prod Postgres", "Old Custom DB", "Sales CRM"])
		expect(body.getByText(name)).toBeTruthy();
	expect(body.getByText("PostgreSQL • Databases")).toBeTruthy();
	expect(body.getByText("HubSpot • CRM")).toBeTruthy();
});

test("marks an integration whose variant is no longer offered as plugin disabled", async () => {
	mockData();
	wrap(<IntegrationsPage />);
	await settle();

	expect(within(document.body).getAllByText("plugin disabled")).toHaveLength(1);
});

test("the group in the URL narrows the page to that category", async () => {
	search = { group: "acme/crm" };
	mockData();
	wrap(<IntegrationsPage />);
	await settle();

	const body = within(document.body);
	expect(body.getByText("Sales CRM")).toBeTruthy();
	expect(body.queryByText("Prod Postgres")).toBeNull();
});

test("search narrows by name, and says so when nothing matches", async () => {
	mockData();
	wrap(<IntegrationsPage />);
	await settle();

	const input = within(document.body).getByPlaceholderText("Search by name or type…");
	fireEvent.change(input, { target: { value: "hubspot" } });
	expect(within(document.body).queryByText("Prod Postgres")).toBeNull();
	expect(within(document.body).getByText("Sales CRM")).toBeTruthy();

	fireEvent.change(input, { target: { value: "zzz" } });
	expect(document.body.textContent).toContain("No integrations match your search");
});

test("an empty category offers to connect one", async () => {
	search = { group: "kv" };
	mockData();
	wrap(<IntegrationsPage />);
	await settle();

	expect(document.body.textContent).toContain("No KV connected to this project yet.");
	fireEvent.click(
		within(document.body)
			.getAllByRole("button", { name: /Connect App/ })
			.at(-1)!,
	);
	expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { group: "kv" } }));
});

test("shows a plugin variant's own icon, and the group's when the image fails (#977)", async () => {
	const icon = "data:image/svg+xml;base64,PHN2Zy8+";
	search = { group: "acme/crm" };
	mockData(icon);
	wrap(<IntegrationsPage />);
	await settle();

	const card = document.body;
	const img = card.querySelector("img");
	expect(img?.getAttribute("src")).toBe(icon);
	fireEvent.error(img!);
	expect(card.querySelector("img")).toBeNull();
	expect(card.querySelector("svg")).not.toBeNull();
});

test("pages a long list and keeps the footer in view", async () => {
	spyOn(projectsService, "getById").mockResolvedValue({ id: "p1", name: "My Project" } as any);
	spyOn(integrationService, "getVariants").mockResolvedValue([
		{
			group: "database",
			label: "Databases",
			builtIn: true,
			variants: [{ variant: "PostgreSQL", label: "PostgreSQL", builtIn: true }],
		},
	] as any);
	spyOn(integrationService, "getBasicList").mockResolvedValue(
		Array.from({ length: 25 }, (_, n) => row(`i${n}`, `DB ${n}`, "database", "PostgreSQL")),
	);
	wrap(<IntegrationsPage />);
	await settle();

	const body = within(document.body);
	// the default page size is 20
	expect(body.getByText("DB 19")).toBeTruthy();
	expect(body.queryByText("DB 20")).toBeNull();
	expect(body.getByText("Page 1 of 2")).toBeTruthy();

	fireEvent.click(body.getByRole("button", { name: "Next" }));
	expect(body.getByText("DB 20")).toBeTruthy();
	expect(body.queryByText("DB 0")).toBeNull();
	expect(body.getByText("Page 2 of 2")).toBeTruthy();

	// searching goes back to the first page
	fireEvent.change(body.getByPlaceholderText("Search by name or type…"), {
		target: { value: "DB" },
	});
	expect(body.getByText("Page 1 of 2")).toBeTruthy();
});
