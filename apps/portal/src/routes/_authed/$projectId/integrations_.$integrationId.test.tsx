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
		useParams: () => ({ projectId: "p1", integrationId: "int-1" }),
	}),
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Route } = await import("./integrations_.$integrationId");
const { integrationService } = await import("@/services/integrations");
const { projectsService } = await import("@/services/projects");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const icon = "data:image/svg+xml;base64,PHN2Zy8+";

test("the detail page shows a plugin variant's own icon, and the group's when the image fails (#977)", async () => {
	spyOn(projectsService, "getById").mockResolvedValue({ id: "p1", name: "My Project" } as any);
	spyOn(integrationService, "getVariants").mockResolvedValue([
		{
			group: "acme/crm",
			label: "acme/crm",
			builtIn: false,
			variants: [
				{
					variant: "HubSpot",
					label: "HubSpot",
					builtIn: false,
					plugin: "acme/crm",
					icon,
					params: {},
					hasTest: false,
				},
			],
		},
	] as any);
	spyOn(integrationService, "getById").mockResolvedValue({
		id: "int-1",
		name: "Sales CRM",
		group: "acme/crm",
		variant: "HubSpot",
		config: {},
		devConfig: null,
		syncDev: true,
	} as any);

	const Page = (Route as any).component as () => ReactNode;
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<Page />
		</QueryClientProvider>,
	);
	await act(async () => new Promise((r) => setTimeout(r, 80)));

	const header = () => document.querySelector("h1")?.parentElement?.parentElement;
	const img = header()?.querySelector("img");
	expect(img?.getAttribute("src")).toBe(icon);
	fireEvent.error(img!);
	expect(header()?.querySelector("img")).toBeNull();
});
