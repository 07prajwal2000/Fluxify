import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { integrationService } = await import("@/services/integrations");
const { ModelSelectorModal } = await import("./ModelSelectorModal");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const models = [
	{ id: "gpt-4o", name: "GPT 4o", contextLength: 128000, pricing: { input: 2.5, output: 10 } },
	{ id: "gpt-3.5" },
	{ id: "claude-x" },
];

// a resolved promise sets state outside React's own scheduler: flush it inside `act`
const flush = () => act(async () => {});

async function setup(result: unknown = { models }) {
	const list = spyOn(integrationService, "listModels").mockImplementation(
		(async () => result) as never,
	);
	const onSelect = mock();
	const onOpenChange = mock();
	// not `document`: RTL stays bound to the document of whichever test file loaded it first
	const { baseElement } = render(
		<ModelSelectorModal
			projectId="p1"
			variant="OpenAI"
			config={{ apiKey: "cfg:KEY" }}
			isOpen
			onOpenChange={onOpenChange}
			selectedValue="gpt-3.5"
			onSelect={onSelect}
		/>,
	);
	await flush();
	return { list, onSelect, onOpenChange, ui: within(baseElement) };
}

test("loads on open, shows details, highlights the current value and picks a row", async () => {
	const { list, onSelect, onOpenChange, ui } = await setup();
	expect(list).toHaveBeenCalledWith("p1", "OpenAI", { apiKey: "cfg:KEY" }, undefined);
	expect(ui.getByText(/128k context/)).toBeTruthy();
	expect(ui.getByText("gpt-3.5").closest("button")?.getAttribute("aria-pressed")).toBe("true");
	fireEvent.click(ui.getByText("claude-x"));
	expect(onSelect).toHaveBeenCalledWith("claude-x");
	expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("search filters by id and name; no exact match offers the typed text", async () => {
	const { onSelect, ui } = await setup();
	fireEvent.change(ui.getByLabelText("Search models"), { target: { value: "GPT 4" } });
	expect(ui.queryByText("claude-x")).toBeNull();
	expect(ui.getByText("gpt-4o")).toBeTruthy();
	fireEvent.change(ui.getByLabelText("Search models"), { target: { value: "my-finetune" } });
	fireEvent.click(ui.getByText("my-finetune"));
	expect(onSelect).toHaveBeenCalledWith("my-finetune");
});

test("refresh asks the server to skip its cache", async () => {
	const { list, ui } = await setup();
	fireEvent.click(ui.getByLabelText("Refresh models"));
	await flush();
	expect(list).toHaveBeenCalledTimes(2);
	expect(list.mock.calls[1]![3]).toBe(true);
});

test("a failure shows the reason and free text still works", async () => {
	const { onSelect, ui } = await setup({ models: [], error: "Add an API key to load models" });
	expect(ui.getByRole("alert").textContent).toContain("Add an API key to load models");
	fireEvent.change(ui.getByLabelText("Search models"), { target: { value: "custom-id" } });
	fireEvent.click(ui.getByText("custom-id"));
	expect(onSelect).toHaveBeenCalledWith("custom-id");
});
