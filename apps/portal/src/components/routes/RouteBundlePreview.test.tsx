import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { RouteBundle } from "@/services/routes";

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
	// spelled out: an earlier file's router mock may have left it out of the spread above
	Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RouteBundlePreview } = await import("./RouteBundlePreview");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const bundle = {
	route: { name: "Get users", path: "/users" },
	canvas: {
		blocks: [
			{ id: "entry", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
			{ id: "reply", type: "response", data: { httpCode: "200" }, position: { x: 250, y: 0 } },
		],
		edges: [
			{
				id: "e1",
				from: "entry",
				to: "reply",
				fromHandle: "entry-success",
				toHandle: "reply-target",
			},
		],
	},
} as unknown as RouteBundle;

test("draws every block of the route on a read-only canvas", async () => {
	// the canvas is a lazy chunk; load it first, and render inside act so the update it
	// triggers is flushed even when an earlier file in the process has used React
	await import("@/components/ai/preview/CanvasDiffGraph");
	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<QueryClientProvider client={new QueryClient()}>
				<RouteBundlePreview bundle={bundle} />
			</QueryClientProvider>,
		);
	});

	const blocks = () => [...(view?.container.querySelectorAll("[data-block-key]") ?? [])];
	await waitFor(() => expect(blocks().length).toBe(2), { timeout: 15_000 });
	expect(
		blocks()
			.map((el) => el.getAttribute("data-block-key"))
			.sort(),
	).toEqual(["entry", "reply"]);
});

test("opens a block's settings, and they cannot be edited", async () => {
	await import("@/components/ai/preview/CanvasDiffGraph");
	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<QueryClientProvider client={new QueryClient()}>
				<RouteBundlePreview bundle={bundle} />
			</QueryClientProvider>,
		);
	});
	const root = () => view?.container.ownerDocument.body as HTMLElement;
	await waitFor(() => expect(root().querySelector('[data-block-key="reply"]')).toBeTruthy(), {
		timeout: 15_000,
	});

	await act(async () => {
		fireEvent.click(root().querySelector('[data-block-key="reply"]') as HTMLElement);
	});

	// the panel is there (a block name field at least), and nothing in it takes input
	const fields = [...root().querySelectorAll<HTMLInputElement>("input, textarea, select")];
	expect(fields.some((f) => f.getAttribute("aria-label") === "Block name")).toBe(true);
	for (const field of fields) expect(field.disabled || field.readOnly).toBe(true);
});
