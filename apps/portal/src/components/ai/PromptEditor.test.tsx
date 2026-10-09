import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

mock.module("./AgentModel", () => ({ AgentModelLabel: () => null }));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const q = () => within(document.body);
const { PromptEditor } = await import("./PromptEditor");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const editor = (props: Partial<Parameters<typeof PromptEditor>[0]> = {}) =>
	render(
		<PromptEditor
			projectId="p1"
			value=""
			onChange={() => {}}
			onSubmit={() => {}}
			typewriter={false}
			slashCommands
			{...props}
		/>,
	);
const commands = () => q().queryByRole("listbox", { name: "Commands" });

test("a lone / at the start suggests /compact, narrowing as it is typed", () => {
	const { rerender } = editor({ value: "/" });
	expect(within(commands() as HTMLElement).getByRole("option").textContent).toContain("/compact");
	rerender(
		<PromptEditor
			projectId="p1"
			value="/co"
			onChange={() => {}}
			onSubmit={() => {}}
			typewriter={false}
			slashCommands
		/>,
	);
	expect(commands()).not.toBeNull();
	rerender(
		<PromptEditor
			projectId="p1"
			value="/x"
			onChange={() => {}}
			onSubmit={() => {}}
			typewriter={false}
			slashCommands
		/>,
	);
	expect(commands()).toBeNull();
});

test("no suggestion for ordinary text, after the command, while a run is active, or outside the chat", () => {
	for (const props of [
		{ value: "hello /" },
		{ value: "/compact keep the ids" },
		{ value: "/", isRunning: true },
		{ value: "/", slashCommands: false },
	]) {
		const { unmount } = editor(props);
		expect(commands()).toBeNull();
		unmount();
	}
});

test("picking a suggestion fills the editor with the command", () => {
	const seen: string[] = [];
	const listen = (e: Event) => seen.push((e as CustomEvent<{ text: string }>).detail.text);
	document.addEventListener("set-editor-text", listen);
	editor({ value: "/" });
	act(() => {
		fireEvent.click(within(commands() as HTMLElement).getByRole("option"));
	});
	document.removeEventListener("set-editor-text", listen);
	expect(seen).toEqual(["/compact "]);
});

test("Enter on a half-typed command completes it instead of sending; a whole one is sent", async () => {
	const sent: string[] = [];
	const filled: string[] = [];
	const listen = (e: Event) => filled.push((e as CustomEvent<{ text: string }>).detail.text);
	document.addEventListener("set-editor-text", listen);
	const { rerender } = editor({ value: "/com", onSubmit: (t) => sent.push(t) });
	const box = document.querySelector("[contenteditable]") as HTMLElement;
	await act(async () => {
		fireEvent.keyDown(box, { key: "Enter" });
	});
	expect(filled).toEqual(["/compact "]);
	expect(sent).toEqual([]);
	rerender(
		<PromptEditor
			projectId="p1"
			value="/compact"
			onChange={() => {}}
			onSubmit={(t) => sent.push(t)}
			typewriter={false}
			slashCommands
		/>,
	);
	await act(async () => {
		fireEvent.keyDown(box, { key: "Enter" });
	});
	document.removeEventListener("set-editor-text", listen);
	expect(sent).toEqual(["/compact"]);
});

test("Tab completes a half-typed command like Enter; with nothing to complete it does nothing", async () => {
	const filled: string[] = [];
	const listen = (e: Event) => filled.push((e as CustomEvent<{ text: string }>).detail.text);
	document.addEventListener("set-editor-text", listen);
	const { rerender } = editor({ value: "/co" });
	const box = document.querySelector("[contenteditable]") as HTMLElement;
	const tab = async () => {
		const down = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
		await act(async () => {
			box.dispatchEvent(down);
		});
		return down.defaultPrevented;
	};
	expect(await tab()).toBe(true);
	expect(filled).toEqual(["/compact "]);
	rerender(
		<PromptEditor
			projectId="p1"
			value="hello"
			onChange={() => {}}
			onSubmit={() => {}}
			typewriter={false}
			slashCommands
		/>,
	);
	expect(await tab()).toBe(false);
	document.removeEventListener("set-editor-text", listen);
	expect(filled).toEqual(["/compact "]);
});
