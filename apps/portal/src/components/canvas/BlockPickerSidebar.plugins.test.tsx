import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

// custom blocks read the route; this file is about the plugins section
mock.module("./blocks/useCustomBlockDefs", () => ({
	useCustomBlockDefs: () => [],
	useAddableCustomBlockDefs: () => [],
}));

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { BlockPickerSidebar } = await import("./BlockPickerSidebar");
const { PluginBlocksContext } = await import("./plugins/PluginBlocksContext");
const { agent, blocksOf, legacy, post, search, slack } = await import("./plugins/fixtures");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup(
	blocks = blocksOf(slack([post, legacy, search]), slack([agent], { name: "acme/agent" })),
	filter?: (type: string) => boolean,
) {
	const onAdd = mock();
	const onOpenChange = mock();
	render(
		<PluginBlocksContext.Provider value={blocks}>
			<BlockPickerSidebar
				isOpen
				onOpenChange={onOpenChange}
				onAdd={onAdd}
				filter={filter}
				filterReason="No room."
			/>
		</PluginBlocksContext.Provider>,
	);
	const body = within(document.body);
	const options = () => body.queryAllByRole("option").map((o) => o.textContent ?? "");
	const open = (name: RegExp) => fireEvent.click(body.getByRole("option", { name }));
	const type = (value: string) =>
		fireEvent.change(body.getByRole("combobox"), { target: { value } });
	return { body, onAdd, onOpenChange, options, open, type };
}

test("Plugins is its own category, apart from Custom blocks", () => {
	const { options } = setup();
	const names = options();
	expect(names.some((n) => n.startsWith("Plugins"))).toBe(true);
	expect(names.some((n) => n.startsWith("Custom"))).toBe(false);
});

test("the folder tree goes scope, plugin, folder, block, and a block is added from it", () => {
	const { body, options, open, onAdd, onOpenChange } = setup();

	open(/^Plugins/);
	expect(options()).toEqual(["acme4 blocks"]);
	open(/^acme/);
	expect(options()).toEqual(["agent1 block", "slack3 blocks"]);
	expect(body.getByText("Plugins / acme")).toBeTruthy();

	open(/^slack/);
	expect(options()).toEqual(["messages2 blocks", "SearchFind a message"]);
	open(/^messages/);
	// deprecated blocks last
	expect(options()).toEqual([
		"Post messageacme/slack/messages/post",
		"Old postDeprecatedacme/slack/messages/legacy",
	]);
	expect(body.getByText("Plugins / acme / slack / messages")).toBeTruthy();

	fireEvent.click(body.getByRole("option", { name: /^Post message/ }));
	expect(onAdd).toHaveBeenCalledWith(post.name);
	expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("Back climbs one folder at a time, then out of Plugins", () => {
	const { body, options, open } = setup();
	open(/^Plugins/);
	open(/^acme/);
	open(/^slack/);

	const back = () =>
		fireEvent.click(body.getByRole("button", { name: /^(Categories|Plugins|acme|slack)$/ }));
	back();
	expect(options()).toEqual(["agent1 block", "slack3 blocks"]);
	back();
	expect(options()).toEqual(["acme4 blocks"]);
	back();
	expect(options().some((n) => n.startsWith("Core"))).toBe(true);
});

test("a search finds plugin blocks by label and by path", () => {
	const { options, type } = setup();

	type("search");
	expect(options()).toEqual(["Searchacme/slack/search"]);
	type("slack/messages");
	expect(options()).toEqual([
		"Post messageacme/slack/messages/post",
		"Old postDeprecatedacme/slack/messages/legacy",
	]);
});

test("a deprecated block shows a badge whose tooltip is the message", () => {
	const { body, open } = setup();
	open(/^Plugins/);
	open(/^acme/);
	open(/^slack/);
	open(/^messages/);

	const badge = body.getByLabelText(/^Deprecated:/);
	expect(badge.getAttribute("title")).toBe(legacy.deprecated);
});

test("a plugin waiting for its first approval offers no blocks to add", () => {
	const { options } = setup(blocksOf(slack([post], { approval: "pending" })));
	expect(options().some((n) => n.startsWith("Plugins"))).toBe(false);
});

test("inside a connection only blocks with an input and an output are offered", () => {
	const specs = blocksOf(slack([post, search]));
	const { open, body } = setup(specs, (type) => type !== search.name);
	open(/^Plugins/);
	open(/^acme/);
	open(/^slack/);

	expect(body.getByRole("option", { name: /^Search/ }).getAttribute("aria-disabled")).toBe("true");
});
