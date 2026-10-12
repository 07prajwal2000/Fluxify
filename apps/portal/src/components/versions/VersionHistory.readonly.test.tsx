import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
// React Flow measures its nodes with these
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
Element.prototype.scrollIntoView = () => {};

const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useParams: () => ({ projectId: "p1" }),
	useMatch: () => undefined,
	useNavigate: () => () => {},
	useRouter: () => ({}),
	Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { versionsService } = await import("@/services/versions");
const { customBlocksService } = await import("@/services/customBlocks");
const { deploymentsService } = await import("@/services/deployments");
const { VersionHistory } = await import("./VersionHistory");

type VersionKind = import("@/services/versions").VersionKind;

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

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

const version = (kind: VersionKind) => ({
	id: "v1",
	kind,
	targetId: kind === "middleware" ? "m1" : "b1",
	versionNumber: 1,
	title: "Initial",
	description: null,
	author: "Ada",
	authorEmail: "ada@x.io",
	createdAt: "2026-10-01T10:00:00.000Z",
	parentId: null,
	isHead: true,
	isProd: false,
});

function stub(kind: VersionKind, settings: Record<string, unknown>) {
	spyOn(versionsService, "list").mockResolvedValue({
		versions: [version(kind)],
		uncommitted: false,
	} as never);
	spyOn(versionsService, "get").mockResolvedValue({
		...version(kind),
		snapshot: {
			blocks:
				kind === "custom_block"
					? [
							{
								id: "en",
								key: "entrypoint_1",
								type: "entrypoint",
								data: {},
								position: { x: 0, y: 0 },
							},
							{
								id: "rs",
								key: "response_1",
								type: "response",
								data: {},
								position: { x: 200, y: 0 },
							},
						]
					: [],
			edges: [],
			settings,
		},
	} as never);
	spyOn(deploymentsService, "list").mockResolvedValue({ deployments: [] } as never);
}

function renderHistory(kind: VersionKind, id: string) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<VersionHistory
				kind={kind}
				id={id}
				projectId="p1"
				tab="versions"
				onTabChange={() => undefined}
				settingsOpen
				onBackToCanvas={() => undefined}
				onOpenSandbox={() => undefined}
			/>
		</QueryClientProvider>,
	);
}

beforeEach(() =>
	authStore.setState((s) => {
		s.state.acl = { p1: "creator" };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	}),
);

test("a custom block version is its canvas and its inputs, read-only: no Save, no fields", async () => {
	stub("custom_block", {
		usage: "flow",
		inputParams: [{ type: "text_input", name: "message", label: "Message", description: "" }],
	});
	const view = renderHistory("custom_block", "b1");
	await until(() => expect(document.body.querySelectorAll(".react-flow__node")).toHaveLength(2));
	expect(view.queryByRole("button", { name: "Save" })).toBeNull();
	expect(view.getByText("Message")).toBeTruthy();
	// the settings are text, not inputs
	expect(view.getByLabelText("Version settings").querySelector("input, textarea")).toBeNull();
});

test("a middleware version is its ordered chain, read-only, with no settings sidebar", async () => {
	stub("middleware", { chain: ["b1", "b2"] });
	spyOn(customBlocksService, "getAll").mockResolvedValue([
		{ id: "b1", label: "Auth check", name: "auth", icon: null, iconUrl: null },
		{ id: "b2", label: "Log request", name: "log", icon: null, iconUrl: null },
	] as never);
	const view = renderHistory("middleware", "m1");
	await until(() => view.getByText("Auth check"));

	const chain = view.getByLabelText("Version chain");
	expect(chain.textContent).toContain("Auth check");
	expect(chain.textContent).toContain("Log request");
	expect(chain.querySelector("input, textarea")).toBeNull();
	expect(view.queryByRole("button", { name: "Save" })).toBeNull();
	expect(view.queryByLabelText("Version settings")).toBeNull();
});

test("a middleware chain shows a block deleted since as such", async () => {
	stub("middleware", { chain: ["gone"] });
	spyOn(customBlocksService, "getAll").mockResolvedValue([] as never);
	const view = renderHistory("middleware", "m1");
	await until(() => view.getByText("Deleted block"));
});
