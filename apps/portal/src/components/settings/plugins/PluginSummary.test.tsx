import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { PluginBlocks } = await import("./PluginSummary");
const { pluginBlockIcon, PluginTriggerIcon } = await import("./pluginBlockIcon");
const { plugin } = await import("./fixtures");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const withIcon = (icon?: string) => {
	const p = plugin();
	const blocks = p.manifest.blocks as Record<string, object>;
	const [name] = Object.keys(blocks);
	blocks[name] = { ...blocks[name], icon };
	return p;
};

test("a block with an icon renders it as an image, without printing the icon", () => {
	const icon = "data:image/png;base64,AAAA";
	const { container } = render(<PluginBlocks plugin={withIcon(icon)} />);
	expect(container.querySelector("img")?.getAttribute("src")).toBe(icon);
	expect(container.textContent).not.toContain("data:image");
});

test("a block without one gets the default icon", () => {
	const { container } = render(<PluginBlocks plugin={withIcon()} />);
	expect(container.querySelector("img")).toBeNull();
	expect(container.querySelector("svg")).not.toBeNull();
});

test("a trigger kind without an icon, or one that fails to load, gets the bolt", () => {
	const empty = render(<PluginTriggerIcon icon="" />);
	expect(empty.container.querySelector("img")).toBeNull();
	expect(empty.container.querySelector("svg")).not.toBeNull();
	cleanup();

	const broken = render(<PluginTriggerIcon icon="data:image/png;base64,broken" />);
	const img = broken.container.querySelector("img");
	expect(img).not.toBeNull();
	fireEvent.error(img!);
	expect(broken.container.querySelector("img")).toBeNull();
	expect(broken.container.querySelector("svg")).not.toBeNull();
});

test("pluginBlockIcon is the custom block icon value", () => {
	expect(pluginBlockIcon({ icon: "data:x" } as never)).toEqual({
		icon: "custom",
		iconUrl: "data:x",
	});
	expect(pluginBlockIcon({} as never)).toEqual({});
});

test("an integration of the plugin shows its icon, from the manifest (#977)", async () => {
	const { PluginIntegrations } = await import("./PluginSummary");
	const icon = "data:image/svg+xml;base64,PHN2Zy8+";
	const entry = { group: "acme/crm", variant: "Hub", label: "Hub", icon };
	const p = plugin({
		manifest: { ...plugin().manifest, integrations: [entry] } as never,
		integrations: [
			{
				group: "acme/crm",
				variant: "Hub",
				label: "Hub",
				ownGroup: true,
				secretParams: [],
				hooks: { test: false, describe: false, inspect: false },
			},
		],
	});
	const { container } = render(<PluginIntegrations plugin={p} />);
	expect(container.querySelector("img")?.getAttribute("src")).toBe(icon);
	fireEvent.error(container.querySelector("img")!);
	expect(container.querySelector("img")).toBeNull();
});
