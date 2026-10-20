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
	const [show, setShow] = useState(false);
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

test("plugin blocks stay hidden until the checkbox is ticked, then show grouped and read-only", async () => {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<Harness />
		</QueryClientProvider>,
	);
	await until(() => expect(document.body.textContent).toContain("My block"));
	expect(document.body.textContent).not.toContain("Plugin blocks");
	expect(list).not.toHaveBeenCalled();

	const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
	await act(async () => void fireEvent.click(box));
	await until(() => expect(document.body.textContent).toContain("Plugin blocks"));

	const section = document.querySelector('[aria-label="Plugin blocks"]')!;
	expect(section.textContent).toContain("acme/slack/messages");
	expect(section.textContent).toContain("acme/slack/channels");
	expect(section.textContent).toContain("Deprecated");
	expect(section.textContent).toContain("Approved");
	expect(section.textContent).not.toContain("acme/mail");
	// a link to the plugin, nothing to open, edit or delete
	expect([...section.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
		"Open plugin",
		"Open plugin",
	]);
	expect(section.querySelectorAll("button, [role=button]").length).toBe(0);
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
	await until(() => expect(document.body.textContent).toContain("My block"));
	await act(async () => void fireEvent.click(document.querySelector('input[type="checkbox"]')!));
	const section = await until(() => {
		const el = document.querySelector('[aria-label="Plugin blocks"]')!;
		expect(el.textContent).toContain("acme/slack/messages");
		return el;
	});
	expect([...section.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual([icon]);
	expect(section.querySelectorAll("svg").length).toBe(1);
});
