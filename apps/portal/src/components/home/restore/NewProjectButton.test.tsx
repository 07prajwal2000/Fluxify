import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { ArchiveSummary } from "@/services/projects";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the page owns navigation; a Link needs a router, so both are stubbed
const navigate = mock((_: unknown) => {});
const router = { ...(await import("@tanstack/react-router")) };
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
	Link: ({
		to,
		params,
		search,
		children,
		...rest
	}: {
		to: string;
		params?: Record<string, string>;
		search?: Record<string, string>;
		children: ReactNode;
	}) => (
		<a
			{...rest}
			href={`${Object.entries(params ?? {}).reduce((p, [k, v]) => p.replace(`$${k}`, v), to)}?${new URLSearchParams(search)}`}
		>
			{children}
		</a>
	),
}));

// the read-only canvas is ReactFlow, which this file has no need to draw: it shows what it was given
const graphActual = { ...(await import("@/components/ai/preview/CanvasDiffGraph")) };
mock.module("@/components/ai/preview/CanvasDiffGraph", () => ({
	default: ({ diff }: { diff: { blocks: { type: string }[] } }) => (
		<div data-testid="canvas">canvas: {diff.blocks.map((b) => b.type).join(", ")}</div>
	),
}));

const { AxiosError } = await import("axios");
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { projectsService } = await import("@/services/projects");
const { NewProjectButton } = await import("./NewProjectButton");

afterEach(cleanup);
afterAll(() => {
	GlobalRegistrator.unregister();
	// the registry is process-wide: hand the real router back to the files that run next
	mock.module("@tanstack/react-router", () => router);
	mock.module("@/components/ai/preview/CanvasDiffGraph", () => graphActual);
});
beforeEach(() => {
	mock.restore();
	navigate.mockClear();
});

/** Not RTL's waitFor/screen: they stay bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 1500): Promise<T> {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			return check();
		} catch (e) {
			if (Date.now() > end) throw e;
			await act(() => new Promise((r) => setTimeout(r, 20)));
		}
	}
}

const text = () => document.body.textContent ?? "";
const button = (name: string) => {
	const found = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name,
	);
	if (!found) throw new Error(`no button ${name}`);
	return found;
};
const field = (label: string) => {
	const found = [...document.body.querySelectorAll("label")].find((l) => l.textContent === label);
	const input = found && document.getElementById(found.htmlFor);
	if (!input) throw new Error(`no field ${label}`);
	return input as HTMLInputElement;
};

const SUMMARY: ArchiveSummary = {
	mode: "template" as const,
	release: "2026.11.1",
	createdAt: "2026-11-14T10:00:00.000Z",
	source: { name: "Orders", slug: "orders" },
	sections: { routes: 2, workflows: 2, plugins: 1 },
	encrypted: false,
	readme: "# Orders template\n\nSet the **database** first.",
	warnings: [
		{ section: "triggers", message: 'Group "jobs" has 7 triggers; this instance allows 5.' },
	],
	preview: [
		{
			section: "routes",
			items: [
				{
					name: "list-orders",
					summary: "GET /orders",
					details: { Production: "Off (templates restore switched off)", "Test suites": 2 },
					canvas: {
						blocks: [
							{ id: "b1", type: "entrypoint", position: { x: 0, y: 0 }, data: {} },
							{
								id: "b2",
								type: "jsrunner",
								position: { x: 200, y: 0 },
								data: { value: "return 1" },
							},
						],
						edges: [
							{ id: "e1", from: "b1", to: "b2", fromHandle: "b1-source", toHandle: "b2-target" },
						],
					},
				},
				{
					name: "get-order",
					summary: "GET /orders/:id",
					details: {},
					canvas: { blocks: [], edges: [] },
				},
			],
		},
		{
			section: "integrations",
			items: [
				{
					name: "pg-main",
					summary: "database · PostgreSQL",
					details: { Production: "Credentials left blank" },
				},
			],
		},
		{ section: "triggers", items: [] },
	],
	suggested: { name: "Orders (2)", slug: "orders-2" },
};

/** a left-nav entry, by its label */
const nav = (label: string) => {
	const found = [
		...document.body.querySelectorAll('nav[aria-label="What the file holds"] button'),
	].find((b) => b.textContent?.startsWith(label));
	if (!found) throw new Error(`no nav entry ${label}`);
	return found as HTMLElement;
};

function renderButton() {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<NewProjectButton />
		</QueryClientProvider>,
	);
}

/** picks a file the way the browser's picker hands it over */
const pick = () =>
	act(async () => {
		const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
		fireEvent.change(input, { target: { files: [new File(["tgz"], "orders.tar.gz")] } });
	});

test("New Project still opens the form; the arrow offers a file", async () => {
	const click = spyOn(HTMLInputElement.prototype, "click");
	renderButton();
	fireEvent.click(button("New Project"));
	expect(navigate).toHaveBeenCalledWith({ to: "/projects/new" });

	fireEvent.click(
		document.body.querySelector('button[aria-label="More ways to create a project"]')!,
	);
	const item = await until(() => {
		const found = [...document.body.querySelectorAll('[role="menuitem"]')].find(
			(el) => el.textContent?.trim() === "From backup or template file",
		);
		if (!found) throw new Error("no menu item");
		return found;
	});
	fireEvent.click(item);
	await until(() => expect(click).toHaveBeenCalled());
});

test("shows what the file holds, then creates the project and opens it", async () => {
	const inspect = spyOn(projectsService, "inspectArchive").mockResolvedValue(SUMMARY);
	const restore = spyOn(projectsService, "restore").mockResolvedValue({ id: "p9", warnings: [] });
	renderButton();
	await pick();

	await until(() => expect(text()).toContain("Orders (orders)"));
	// the README has its own page
	expect(text()).not.toContain("Set the database first");
	fireEvent.click(nav("README"));
	await until(() => expect(text()).toContain("Set the database first"));
	fireEvent.click(nav("Overview"));
	await until(() => field("Slug"));
	expect(inspect).toHaveBeenCalled();
	expect(text()).toContain("orders.tar.gz");
	expect(text()).toContain("Template");
	expect(text()).toContain("2026.11.1");
	expect(text()).toContain("Orders (orders)");
	expect(text()).toContain('Group "jobs" has 7 triggers');
	expect(field("Project name").value).toBe("Orders (2)");
	expect(field("Slug").value).toBe("orders-2");
	expect(restore).not.toHaveBeenCalled();

	fireEvent.change(field("Slug"), { target: { value: "orders-copy" } });
	fireEvent.change(field("Subdomain"), { target: { value: "orders-eu" } });
	fireEvent.change(field("Description"), { target: { value: "EU orders" } });
	await act(async () => {
		fireEvent.click(button("Create project"));
	});
	await until(() =>
		expect(navigate).toHaveBeenCalledWith({ to: "/$projectId", params: { projectId: "p9" } }),
	);
	expect(restore.mock.calls[0]?.[1]).toEqual({
		name: "Orders (2)",
		slug: "orders-copy",
		description: "EU orders",
		subdomain: "orders-eu",
	});
});

test("refuses an invalid subdomain before anything is sent", async () => {
	spyOn(projectsService, "inspectArchive").mockResolvedValue(SUMMARY);
	const restore = spyOn(projectsService, "restore").mockResolvedValue({ id: "p9", warnings: [] });
	renderButton();
	await pick();
	await until(() => field("Subdomain"));
	fireEvent.change(field("Subdomain"), { target: { value: "-bad-" } });
	await until(() => expect(button("Create project").disabled).toBe(true));
	expect(restore).not.toHaveBeenCalled();
});

test("shows the server's refusal before any name is asked for", async () => {
	const refused = new AxiosError("Bad", "ERR_BAD_REQUEST", undefined, undefined, {
		status: 400,
		data: {
			message:
				'Plugin "acme/kv" 1.0.0 can\'t be restored here: The plugin needs @fluxify/sdk ^9, but this Fluxify provides 3.1.0.',
		},
	} as never);
	spyOn(projectsService, "inspectArchive").mockRejectedValue(refused);
	renderButton();
	await pick();

	await until(() => expect(text()).toContain('Plugin "acme/kv" 1.0.0'));
	expect(text()).toContain("@fluxify/sdk ^9");
	expect(() => field("Slug")).toThrow();
	expect(() => button("Create project")).toThrow();
});

test("keeps the dialog open on a taken slug, so it can be changed", async () => {
	spyOn(projectsService, "inspectArchive").mockResolvedValue(SUMMARY);
	const clash = new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
		status: 409,
		data: { message: "Project already exists with 'orders-2' slug" },
	} as never);
	spyOn(projectsService, "restore").mockRejectedValueOnce(clash);
	renderButton();
	await pick();
	await until(() => field("Slug"));
	await act(async () => {
		fireEvent.click(button("Create project"));
	});

	await until(() => expect(text()).toContain("'orders-2' slug"));
	expect(navigate).not.toHaveBeenCalled();
	expect(field("Slug").value).toBe("orders-2");
});

test("lists the restore's warnings, links a plugin to its page, then opens the project", async () => {
	spyOn(projectsService, "inspectArchive").mockResolvedValue(SUMMARY);
	spyOn(projectsService, "restore").mockResolvedValue({
		id: "p9",
		warnings: [
			{
				section: "plugins",
				message: 'Plugin "acme/kv" needs approving before routes that use its blocks will compile.',
			},
			{
				section: "project",
				message: "Compilation could not be queued; open the project and save any route to retry.",
			},
		],
	});
	renderButton();
	await pick();
	await until(() => field("Slug"));
	await act(async () => {
		fireEvent.click(button("Create project"));
	});

	await until(() => expect(text()).toContain("Compilation could not be queued"));
	const link = [...document.body.querySelectorAll("a")].find(
		(a) => a.textContent === "Open the plugin",
	);
	expect(link?.getAttribute("href")).toBe("/p9/settings?tab=plugins&plugin=acme%2Fkv");
	expect(navigate).not.toHaveBeenCalled();
	fireEvent.click(button("Open project"));
	expect(navigate).toHaveBeenCalledWith({ to: "/$projectId", params: { projectId: "p9" } });
});

test("renders the README as Markdown only: no script, no javascript: link", async () => {
	spyOn(projectsService, "inspectArchive").mockResolvedValue({
		...SUMMARY,
		readme:
			'Hello <script>window.__pwned = true</script> <img src=x onerror="window.__pwned=true">\n\n[click](javascript:window.__pwned=true) [docs](https://docs.example.com)',
	});
	renderButton();
	await pick();
	await until(() => nav("README"));
	// its own page, not part of the overview
	expect(document.body.querySelector('section[aria-label="README"]')).toBeNull();
	fireEvent.click(nav("README"));
	const readme = await until(() => {
		const found = document.body.querySelector('section[aria-label="README"]');
		if (!found) throw new Error("no README");
		return found;
	});

	expect(readme.querySelector("script")).toBeNull();
	expect(readme.querySelector("img")).toBeNull();
	expect((window as { __pwned?: boolean }).__pwned).toBeUndefined();
	const links = [...readme.querySelectorAll("a")];
	const click = links.find((a) => a.textContent === "click");
	expect(click?.getAttribute("href") ?? "").not.toContain("javascript:");
	const docs = links.find((a) => a.textContent === "docs");
	expect(docs?.getAttribute("href")).toBe("https://docs.example.com");
	expect(docs?.getAttribute("target")).toBe("_blank");
	expect(docs?.getAttribute("rel")).toBe("noopener noreferrer");
});

test("has no README page when the file has none", async () => {
	spyOn(projectsService, "inspectArchive").mockResolvedValueOnce({ ...SUMMARY, readme: null });
	renderButton();
	await pick();
	await until(() => field("Slug"));
	expect(() => nav("README")).toThrow();
});

test("browses each section read only: the list, the details, the canvas, never a credential", async () => {
	spyOn(projectsService, "inspectArchive").mockResolvedValue(SUMMARY);
	renderButton();
	await pick();
	await until(() => nav("Routes"));
	// counts beside each section, and a warning mark where one applies
	expect(nav("Routes").textContent).toContain("2");
	expect(nav("Triggers").querySelector("svg.text-warning")).not.toBeNull();

	fireEvent.click(nav("Routes"));
	await until(() => expect(text()).toContain("GET /orders"));
	const preview = () =>
		document.body.querySelector('section[aria-label^="Preview of"]') as HTMLElement;
	await until(() => expect(preview().textContent).toContain("list-orders"));
	// the canvas first, the details a tab away
	await until(() => expect(preview().textContent).toContain("canvas: entrypoint, jsrunner"));
	fireEvent.click(
		[...preview().querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Details")!,
	);
	await until(() =>
		expect(preview().textContent).toContain("Off (templates restore switched off)"),
	);
	expect(preview().textContent).toContain("Test suites2");

	fireEvent.click(button("get-orderGET /orders/:id"));
	await until(() => expect(preview().textContent).toContain("The canvas is empty."));

	fireEvent.click(nav("Integrations"));
	await until(() => expect(preview().textContent).toContain("Credentials left blank"));
	// an empty section says so
	fireEvent.click(nav("Triggers"));
	await until(() => expect(text()).toContain("Nothing in this section."));
	expect(text()).toContain('Group "jobs" has 7 triggers');
	// what was typed on the overview is still there when it is reopened
	fireEvent.click(nav("Overview"));
	await until(() => expect(field("Slug").value).toBe("orders-2"));
});

test("has no README page when the README is only whitespace", async () => {
	spyOn(projectsService, "inspectArchive").mockResolvedValueOnce({ ...SUMMARY, readme: " \n\t " });
	renderButton();
	await pick();
	await until(() => field("Slug"));
	expect(() => nav("README")).toThrow();
});
