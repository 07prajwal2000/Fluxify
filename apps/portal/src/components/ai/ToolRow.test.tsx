import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "./agentMessages";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
class Observer {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: Observer });
Object.assign(globalThis, {
	DOMMatrixReadOnly: class {
		m22 = 1;
		constructor() {}
	},
});
mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1" }),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ToolRow } = await import("./ToolRow");
const { agentConversationsService } = await import("@/services/agentConversations");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

async function until<T>(check: () => T, timeout = 2000): Promise<T> {
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

const row = (tool: ToolPart, waiting = false) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ToolRow tool={tool} waiting={waiting} running={false} />
		</QueryClientProvider>,
	);

const at = { x: 0, y: 0 };
const edit: ToolPart = {
	type: "tool",
	id: "t1",
	name: "edit_canvas",
	input: {
		target: { kind: "route", id: "r1" },
		version: 7,
		ops: [{ op: "update_block", id: "response_1", data: { httpCode: "201" } }],
	},
};

const preview = () =>
	spyOn(agentConversationsService, "canvasPreview").mockResolvedValue({
		version: 7,
		before: {
			blocks: [
				{ id: "e", key: "entrypoint_1", type: "entrypoint", data: {}, position: at },
				{
					id: "r",
					key: "response_1",
					type: "response",
					data: { httpCode: "200" },
					position: { x: 250, y: 0 },
				},
			],
			edges: [{ id: "1", from: "e", to: "r", handle: "source" }],
		},
		after: {
			blocks: [
				{ id: "e", key: "entrypoint_1", type: "entrypoint", data: {}, position: at },
				{
					id: "r",
					key: "response_1",
					type: "response",
					data: { httpCode: "201" },
					position: { x: 250, y: 0 },
				},
			],
			edges: [{ id: "1", from: "e", to: "r", handle: "source" }],
		},
		changes: ["updated response_1 (httpCode)"],
		issues: [{ severity: "warning", message: "not connected", block: "response_1" }],
	});

test("a waiting edit_canvas opens by itself on the canvas diff, computed before anything is saved", async () => {
	const ask = preview();
	const view = row(edit, true);
	// no click: the row is open and on Preview
	await until(() =>
		expect(view.container.querySelector('[data-block-key="response_1"]')).not.toBeNull(),
	);
	expect(view.container.querySelector("details")?.open).toBe(true);
	expect(ask).toHaveBeenCalledWith("p1", {
		target: { kind: "route", id: "r1" },
		ops: edit.input && (edit.input as any).ops,
	});
	expect(
		view.container.querySelector('[data-block-key="response_1"]')?.getAttribute("data-status"),
	).toBe("changed");
	const detail = await until(() => view.getByLabelText("response_1 changed"));
	expect(detail.querySelector("del")?.textContent).toBe("200");
	expect(detail.querySelector("ins")?.textContent).toBe("201");
	expect(view.getByText("updated response_1 (httpCode)")).toBeTruthy();
	expect(view.getByText(/not connected/)).toBeTruthy();
	ask.mockRestore();
});

test("an edit the server would refuse shows why, on top", async () => {
	const ask = spyOn(agentConversationsService, "canvasPreview").mockResolvedValue({
		version: 7,
		before: { blocks: [], edges: [] },
		error: "response_9 is not on this canvas",
	});
	const view = row(edit, true);
	const alert = await until(() => view.getByRole("alert"));
	expect(alert.textContent).toContain(
		"This edit would be refused: response_9 is not on this canvas",
	);
	ask.mockRestore();
});

test("when the preview cannot be had, the ops still show what the edit means", async () => {
	const ask = spyOn(agentConversationsService, "canvasPreview").mockRejectedValue(
		new Error("boom"),
	);
	const view = row(edit, true);
	await until(() =>
		expect(view.getByRole("alert").textContent).toContain("Could not preview this edit: boom"),
	);
	await until(() =>
		expect(view.container.querySelector('[data-block-key="response_1"]')).not.toBeNull(),
	);
	ask.mockRestore();
});

test("an edit that ran shows the blocks its ops touched, added ones by the key they got", async () => {
	const ask = preview();
	const view = row({
		...edit,
		input: {
			...(edit.input as object),
			ops: [
				{ op: "add_block", ref: "b1", type: "consolelog", connect_from: { from: "response_1" } },
			],
		},
		output: { version: 8, refs: { b1: "consolelog_2" }, changes: ["added consolelog_2 (b1)"] },
		status: "done",
	});
	// done rows start folded
	expect(view.container.querySelector("details")?.open).toBe(false);
	fireEvent.click(view.getByText("Edit canvas"));
	await until(() =>
		expect(
			view.container.querySelector('[data-block-key="consolelog_2"]')?.getAttribute("data-status"),
		).toBe("added"),
	);
	expect(view.getByText("added consolelog_2 (b1)")).toBeTruthy();
	// no "after" to compute for a finished edit
	expect(ask).not.toHaveBeenCalled();
	ask.mockRestore();
});

test("a call that runs without asking (auto mode) does not ask the server for an 'after'", async () => {
	const ask = preview();
	const view = row({ ...edit, startedAt: 1 }, false);
	fireEvent.click(view.getByText("Edit canvas"));
	await until(() =>
		expect(view.container.querySelector('[data-block-key="response_1"]')).not.toBeNull(),
	);
	expect(ask).not.toHaveBeenCalled();
	ask.mockRestore();
});

test("Raw is today's JSON, unchanged; Preview is the default", async () => {
	const ask = preview();
	const tool = { ...edit, output: { version: 8 }, status: "done" as const };
	const view = row(tool);
	fireEvent.click(view.getByText("Edit canvas"));
	expect(view.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")).toBe("true");
	fireEvent.click(view.getByRole("tab", { name: "Raw" }));
	const pres = [...view.container.querySelectorAll("pre")].map((p) => p.textContent);
	expect(pres).toEqual([JSON.stringify(tool.input, null, 2), JSON.stringify(tool.output, null, 2)]);
	ask.mockRestore();
});
