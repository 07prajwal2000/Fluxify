import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// the plugin groups link to the plugin's page
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useState } = await import("react");
const { CustomBlocksView } = await import("./CustomBlocksView");
const { pluginBlockGroups } = await import("./pluginBlocks");
const { customBlocksService } = await import("@/services/customBlocks");
const { pluginsService } = await import("@/services/plugins");
const { plugin, upgrading } = await import("@/components/settings/plugins/fixtures");

const getAll = spyOn(customBlocksService, "getAll");
const list = spyOn(pluginsService, "list");

const block = (name: string, extra: object = {}) => ({
	...((plugin().manifest.blocks as Record<string, object>)["acme/slack/messages/post"] ?? {}),
	name,
	label: name.split("/").pop(),
	...extra,
});
const withBlocks = (blocks: object[], over = {}) =>
	plugin({
		...over,
		manifest: {
			name: "acme/slack",
			blocks: Object.fromEntries(blocks.map((b: any) => [b.name, b])),
		},
	});

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

beforeEach(() => {
	getAll.mockReset().mockResolvedValue([
		{
			id: "b1",
			name: "myBlock",
			label: "My block",
			description: null,
			inputParams: [],
			sourceType: "user-defined",
		},
	] as never);
	list.mockReset().mockResolvedValue([
		withBlocks([
			block("acme/slack/messages/post", { deprecated: "use send" }),
			block("acme/slack/channels/list"),
		]),
		// waiting for its first approval: loads nothing
		plugin({ id: "pl2", name: "acme/mail", approval: "pending" }),
	]);
});
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function Harness() {
	const [show, setShow] = useState<boolean>();
	return (
		<CustomBlocksView
			projectId="p1"
			showPlugins={show}
			onUsageChange={() => {}}
			onShowPluginsChange={setShow}
			onOpenBlock={() => {}}
			onNewBlock={() => {}}
		/>
	);
}

test("plugin blocks show by default when a plugin ships some, grouped and read-only", async () => {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<Harness />
		</QueryClientProvider>,
	);
	await until(() => expect(document.body.textContent).toContain("Plugin blocks"));
	const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
	expect(box.checked).toBe(true);
	expect(box.disabled).toBe(false);

	const section = document.querySelector('[aria-label="Plugin blocks"]')!;
	expect(section.textContent).toContain("acme/slack/messages");
	expect(section.textContent).toContain("acme/slack/channels");
	expect(section.textContent).toContain("Approved");
	expect(section.textContent).not.toContain("acme/mail");
	// the first type is open, the others collapsed
	expect(section.textContent).toContain("acme/slack/channels/list");
	expect(section.textContent).not.toContain("acme/slack/messages/post");
	expect(section.textContent).not.toContain("Deprecated");
	const toggle = [...section.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("acme/slack/messages"),
	)!;
	expect(toggle.getAttribute("aria-expanded")).toBe("false");
	await act(async () => void fireEvent.click(toggle));
	await until(() => expect(section.textContent).toContain("acme/slack/messages/post"));
	expect(section.textContent).toContain("Deprecated");
	// a link to the plugin per type, nothing to open, edit or delete
	expect([...section.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
		"Open plugin",
		"Open plugin",
	]);

	// unticking still hides them
	await act(async () => void fireEvent.click(box));
	await until(() => expect(document.body.textContent).not.toContain("Plugin blocks"));
});

test("with no plugin blocks the checkbox is off and disabled", async () => {
	list.mockResolvedValue([]);
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<Harness />
		</QueryClientProvider>,
	);
	await until(() => expect(list).toHaveBeenCalled());
	await until(() => expect(document.body.textContent).toContain("My block"));
	const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
	expect(box.checked).toBe(false);
	expect(box.disabled).toBe(true);
	expect(document.body.textContent).not.toContain("Plugin blocks");
});

test("an upgrade waiting for approval still lists the version that loads", () => {
	const groups = pluginBlockGroups([upgrading()]);
	expect(groups.map((g) => g.key)).toEqual(["acme/slack/messages"]);
	expect(pluginBlockGroups([upgrading()], "nothing like it")).toEqual([]);
});

test("a plugin block shows its icon, and the default when it has none", async () => {
	const icon = "data:image/png;base64,AAAA";
	list.mockResolvedValue([
		withBlocks([block("acme/slack/messages/post", { icon }), block("acme/slack/messages/list")]),
	]);
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<Harness />
		</QueryClientProvider>,
	);
	const section = await until(() => {
		const el = document.querySelector('[aria-label="Plugin blocks"]')!;
		expect(el.textContent).toContain("acme/slack/messages");
		return el;
	});
	expect([...section.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual([icon]);
	// only the block without an icon draws the default one (the chevron and footer have their own svgs)
	const row = (text: string) =>
		[...section.querySelectorAll("[role=row]")].find((r) => r.textContent?.includes(text))!;
	expect(row("acme/slack/messages/post").querySelectorAll("svg").length).toBe(0);
	expect(row("acme/slack/messages/list").querySelectorAll("svg").length).toBe(1);
});

test("types are paginated, 5 a page", async () => {
	list.mockResolvedValue([
		withBlocks(["a", "b", "c", "d", "e", "f"].map((f) => block(`acme/slack/${f}/post`))),
	]);
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<Harness />
		</QueryClientProvider>,
	);
	const section = await until(() => {
		const el = document.querySelector('[aria-label="Plugin blocks"]')!;
		expect(el.textContent).toContain("Page 1 of 2");
		return el;
	});
	expect(section.textContent).toContain("acme/slack/e");
	expect(section.textContent).not.toContain("acme/slack/f");
	const next = [...section.querySelectorAll("button")].find((b) => b.textContent === "Next")!;
	await act(async () => void fireEvent.click(next));
	await until(() => expect(section.textContent).toContain("Page 2 of 2"));
	expect(section.textContent).toContain("acme/slack/f");
	expect(section.textContent).not.toContain("acme/slack/e");
});

test("the type with the most blocks comes first, ties by name", () => {
	const groups = pluginBlockGroups([
		withBlocks([
			block("acme/slack/a/one"),
			block("acme/slack/c/one"),
			block("acme/slack/c/two"),
			block("acme/slack/b/one"),
		]),
	]);
	expect(groups.map((g) => g.key)).toEqual(["acme/slack/c", "acme/slack/a", "acme/slack/b"]);
});
