import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render, within } = await import("@testing-library/react");
const { EntryResponseView } = await import("./EntryInputView");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const entry = (metadata: unknown, input: unknown = { method: "GET", headers: {} }) =>
	({
		seq: 0,
		parentSeq: null,
		blockId: "entry",
		blockType: "entrypoint",
		customBlockId: null,
		input,
		output: null,
		truncated: false,
		metadata,
	}) as never;

test("shows the response status and headers beside the request", () => {
	const { container } = render(
		<EntryResponseView
			span={entry({
				response: { status: 201, headers: { "x-trace": "t1", "set-cookie": "a=1\nb=2" } },
			})}
		/>,
	);
	const view = within(container);
	expect(view.getByText("Response")).toBeTruthy();
	expect(view.getByText("201")).toBeTruthy();
	expect(view.getByText("x-trace")).toBeTruthy();
	expect(view.getByText("t1")).toBeTruthy();
	expect(container.textContent).toContain("a=1");
});

test("shows nothing for a run recorded before headers were kept", () => {
	const { container } = render(<EntryResponseView span={entry(null)} />);
	expect(container.textContent).toBe("");
});

test("shows nothing on a workflow's start span", () => {
	const { container } = render(
		<EntryResponseView
			span={entry(
				{ response: { headers: { a: "b" } } },
				{ input: {}, trigger: { kind: "manual" } },
			)}
		/>,
	);
	expect(container.textContent).toBe("");
});
