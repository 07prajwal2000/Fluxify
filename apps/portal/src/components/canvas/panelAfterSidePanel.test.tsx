import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

GlobalRegistrator.register();
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useMatch: () => undefined,
	useParams: () => ({}),
	useNavigate: () => () => {},
	Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CanvasAiProvider, useCanvasAi } = await import("./ai/CanvasAiContext");
const { BlockCanvas } = await import("./BlockCanvas");
const { createBlockNodeTypes } = await import("./blocks");
const { CanvasDiagnosticsProvider, useBlockDiagnostics } = await import("./diagnostics");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const nodeTypes = createBlockNodeTypes();
const graph = {
	blocks: [{ id: "b1", type: "entrypoint", position: { x: 0, y: 0 }, data: {} }],
	edges: [],
} as never;

let ai: ReturnType<typeof useCanvasAi>;
let diag: ReturnType<typeof useBlockDiagnostics>;
function Probe() {
	ai = useCanvasAi();
	diag = useBlockDiagnostics();
	return null;
}
function Preview() {
	return ai?.chat.isOpen ? (
		<div data-preview>
			<BlockCanvas graph={graph} mode="readonly" nodeTypes={nodeTypes} showToolbar={false} />
		</div>
	) : null;
}

function setup() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<CanvasDiagnosticsProvider>
				<CanvasAiProvider projectId="p1">
					<Probe />
					<Preview />
					<div data-outer>
						<BlockCanvas graph={graph} nodeTypes={nodeTypes} showToolbar={false} />
					</div>
				</CanvasAiProvider>
			</CanvasDiagnosticsProvider>
		</QueryClientProvider>,
	);
}

const openPanel = (c: HTMLElement) =>
	c.querySelector("[data-outer] aside.fx-panel--open[data-block-id]");
const dbl = (c: HTMLElement) => {
	const node = c.querySelector("[data-outer] .react-flow__node");
	if (!node) throw new Error("no node");
	fireEvent.doubleClick(node);
};

test("block settings still open after the chat was opened and closed", async () => {
	const { container } = setup();
	await act(async () => ai?.chat.open());
	await act(async () => ai?.chat.close());
	await act(async () => dbl(container));
	expect(openPanel(container)).toBeTruthy();
});

test("block settings still open after Diagnostics was opened and closed", async () => {
	const { container } = setup();
	await act(async () => diag.openPanel());
	await act(async () => diag.closePanel());
	await act(async () => dbl(container));
	expect(openPanel(container)).toBeTruthy();
});

test("any order of chat, Diagnostics and block panel", async () => {
	const { container } = setup();
	const closeBlock = () =>
		fireEvent.click(container.querySelector("[data-outer] aside[data-block-id] .fx-panel__close")!);
	await act(async () => ai?.chat.open());
	await act(async () => dbl(container));
	expect(openPanel(container)).toBeTruthy();
	expect(ai?.chat.isOpen).toBe(false);
	await act(async () => ai?.chat.open());
	expect(openPanel(container)).toBeFalsy();
	await act(async () => diag.openPanel());
	await act(async () => dbl(container));
	expect(openPanel(container)).toBeTruthy();
	await act(async () => closeBlock());
	expect(openPanel(container)).toBeFalsy();
	await act(async () => dbl(container));
	expect(openPanel(container)).toBeTruthy();
});
