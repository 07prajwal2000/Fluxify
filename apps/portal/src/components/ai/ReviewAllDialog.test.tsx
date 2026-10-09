import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
class Observer {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: Observer });
mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1" }),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ReviewAllDialog } = await import("./ReviewAllDialog");
const { agentConversationsService } = await import("@/services/agentConversations");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const q = () => within(document.body);
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

const edit = {
	kind: "tool",
	id: "a",
	name: "edit_canvas",
	title: "Edit canvas",
	input: {
		target: { kind: "route", id: "r1" },
		version: 1,
		ops: [{ op: "remove_block", id: "log_1" }],
	},
	isDelete: false,
} as const;
const del = {
	kind: "tool",
	id: "d",
	name: "delete_route",
	title: "Delete route",
	input: { routeId: "r2" },
	isDelete: true,
} as const;
const at = { x: 0, y: 0 };

function open() {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ReviewAllDialog calls={[edit, del]} open onOpenChange={() => {}} onConfirm={() => {}} />
		</QueryClientProvider>,
	);
}

test("a row's details show the canvas diff or the delete card only once opened", async () => {
	const canvas = spyOn(agentConversationsService, "canvasPreview").mockResolvedValue({
		version: 1,
		before: {
			blocks: [{ id: "l", key: "log_1", type: "consolelog", data: {}, position: at }],
			edges: [],
		},
		after: { blocks: [], edges: [] },
	});
	const resource = spyOn(agentConversationsService, "resourcePreview").mockResolvedValue({
		current: { name: "Old route", method: "GET", path: "/old" },
	});
	open();
	// nothing is fetched while the rows are folded
	expect(canvas).not.toHaveBeenCalled();
	expect(resource).not.toHaveBeenCalled();

	const details = q().getAllByText("Details");
	fireEvent.click(details[0]);
	await until(() => expect(q().getByLabelText("log_1 removed")).toBeTruthy());
	expect(canvas).toHaveBeenCalledTimes(1);

	fireEvent.click(details[1]);
	await until(() => expect(q().getByLabelText("Delete route").textContent).toContain("Old route"));
	expect(q().getByLabelText("Delete route").textContent).toContain("GET /old");
	canvas.mockRestore();
	resource.mockRestore();
});
