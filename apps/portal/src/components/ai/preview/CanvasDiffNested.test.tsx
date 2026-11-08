import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { CanvasDiff } from "./canvasDiff";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
// ReactFlow measures its nodes with these
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

// the real canvas reads the route it sits on
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useParams: () => ({ projectId: "p1" }),
	useMatch: () => undefined,
	useNavigate: () => () => {},
	useRouter: () => ({}),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));
const { act, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CanvasDiffView } = await import("./CanvasDiffView");
const { CanvasAiProvider } = await import("@/components/canvas/ai/CanvasAiContext");

afterAll(() => GlobalRegistrator.unregister());

const diff: CanvasDiff = {
	blocks: [
		{
			key: "entrypoint_1",
			type: "entrypoint",
			status: "same",
			position: { x: 0, y: 0 },
			data: {},
			changes: [],
		},
		{
			key: "response_1",
			type: "response",
			status: "changed",
			position: { x: 250, y: 0 },
			data: {},
			changes: [{ field: "httpCode", before: "200", after: "201" }],
		},
	],
	edges: [{ id: "1", from: "entrypoint_1", to: "response_1", handle: "source", status: "same" }],
};

// #1089: the canvas's chat drew a diff canvas that drew the chat again, forever
test("the diff canvas inside the canvas's AI chat does not render the chat again", async () => {
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<CanvasAiProvider projectId="p1">
				<CanvasDiffView diff={diff} />
			</CanvasAiProvider>
		</QueryClientProvider>,
	);
	const node = () => view.container.querySelector('[data-block-key="response_1"]');
	for (let i = 0; i < 100 && !node(); i++) await act(() => new Promise((r) => setTimeout(r, 20)));
	expect(node()).not.toBeNull();
	expect(view.container.querySelector('aside[aria-label="AI chat"]')).toBeNull();
});
