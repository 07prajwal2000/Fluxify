import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { ToolPart } from "../agentMessages";

GlobalRegistrator.register();
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useParams: () => ({ projectId: "p1" }),
	useMatch: () => undefined,
	useNavigate: () => () => {},
	useRouter: () => ({}),
	Link: ({ to, children, search, ...rest }: any) => {
		const qs = search ? `?${new URLSearchParams(search).toString()}` : "";
		return (
			<a href={`${to}${qs}`} {...rest}>
				{children}
			</a>
		);
	},
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ToolBody } = await import("./ToolBody");
const { ToolRow } = await import("../ToolRow");
const { agentConversationsService } = await import("@/services/agentConversations");

afterEach(() => {
	cleanup();
	mock.restore();
});
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

const withClient = (node: ReactNode) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{node}
		</QueryClientProvider>,
	);

const show = (tool: Partial<ToolPart> & { name: string }) =>
	withClient(
		<ToolBody
			tool={{ type: "tool", id: "t", input: {}, status: "done", ...tool }}
			asking={false}
		/>,
	);
const showRow = (tool: Partial<ToolPart> & { name: string }) =>
	withClient(
		<ToolRow
			tool={{ type: "tool", id: "t", input: {}, status: "done", ...tool }}
			waiting={false}
			running={false}
		/>,
	);

test("call_route's folded row: status, the Dev chip, the request line and how long it took", async () => {
	spyOn(agentConversationsService, "resourcePreview").mockResolvedValue({
		current: { method: "GET", path: "/users/:id" },
	} as never);
	const view = showRow({
		name: "call_route",
		input: { routeId: "r1", params: { id: "42" } },
		output: { status: 200, durationMs: 12 },
	});
	const text = await until(() => {
		const t = view.container.querySelector("summary")?.textContent ?? "";
		expect(t).toContain("GET /users/42");
		return t;
	});
	expect(text).toContain("200");
	expect(text).toContain("Dev");
	expect(text).not.toContain("Prod");
	expect(text).toContain("(12ms)");
});

test("get_version: a card with the number, title, author and a link to its read-only canvas", () => {
	const view = show({
		name: "get_version",
		input: { kind: "route", id: "r1", versionId: "v3" },
		output: {
			versionId: "v3",
			versionNumber: 3,
			title: "Add rate limiting",
			author: "Ada",
			createdAt: "2026-10-01T10:00:00.000Z",
		},
	});
	const text = view.container.textContent ?? "";
	expect(text).toContain("v3 · Add rate limiting");
	expect(text).toContain("Ada");
	expect(text).not.toContain("versionId");
	expect(text).not.toContain("{");
	const link = view.getByText(/read-only canvas/i).closest("a");
	expect(link?.getAttribute("href")).toBe("/p1/canvas/r1/versions?version=v3");
});

test("commit_version: Committed + number and title, and the version's canvas link", () => {
	const view = show({
		name: "commit_version",
		input: { kind: "workflow", id: "w1", title: "Nightly sync" },
		output: { versionId: "wv2", versionNumber: 2, title: "Nightly sync", author: "Ada" },
	});
	const text = view.container.textContent ?? "";
	expect(text).toContain("Committed v2 · Nightly sync");
	const link = view.getByText(/read-only canvas/i).closest("a");
	expect(link?.getAttribute("href")).toBe("/p1/workflow-canvas/w1/versions?version=wv2");
});

test("get_version and commit_version fold to vN · title, never raw JSON", () => {
	const row = showRow({
		name: "get_version",
		input: { kind: "route", id: "r1" },
		output: { versionId: "v9", versionNumber: 9, title: "Tighten auth" },
	});
	const text = row.container.querySelector("summary")?.textContent ?? "";
	expect(text).toContain("v9 · Tighten auth");
	expect(text).not.toContain("{");
});

test("get_block_schemas: names in the folded row, one block per section in the body", () => {
	const row = showRow({
		name: "get_block_schemas",
		input: { blockTypes: ["db_getall", "if"] },
		output:
			"db_getall {\n\tlimit?: number;\n}\nHandles (connect from): success\n\nif {\n\tcondition: string;\n}",
	});
	expect(row.container.querySelector("summary")?.textContent).toContain("db_getall, if");
	expect(row.container.textContent).not.toContain("{");

	const body = show({
		name: "get_block_schemas",
		input: { blockTypes: ["db_getall", "if"] },
		output:
			"db_getall {\n\tlimit?: number;\n}\nHandles (connect from): success\n\nif {\n\tcondition: string;\n}",
	});
	const sections = [...body.container.querySelectorAll("section")];
	expect(sections).toHaveLength(2);
	expect(sections[0].textContent).toContain("db_getall");
	expect(sections[0].textContent).toContain("Handles (connect from): success");
	expect(sections[1].textContent).toContain("if");
});

test("list resources: types in the folded row; bullets in the body, no stray None.", () => {
	const row = showRow({
		name: "list",
		input: { types: ["routes", "workflows"] },
		output: { routes: { items: [] }, workflows: { items: [] } },
	});
	expect(row.container.querySelector("summary")?.textContent).toContain("routes, workflows");

	const view = show({
		name: "list",
		input: { types: ["routes", "workflows"] },
		output: {
			routes: { items: [{ id: "r1", name: "Users", method: "GET", path: "/users" }] },
			workflows: { items: [] },
		},
	});
	expect([...view.container.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
		"GET /users",
	]);
	expect(view.container.textContent).not.toContain("None.");
	expect(view.container.querySelector('a[href="/p1/canvas/r1"]')).not.toBeNull();
});

test("list resources: a type that failed shows its error, not None.", () => {
	const view = show({
		name: "list",
		input: { types: ["routes"] },
		output: { routes: { error: "boom" } },
	});
	const alert = view.getByRole("alert");
	expect(alert.textContent).toContain("boom");
	expect(view.container.textContent).not.toContain("None.");
});

test("a failed edit_canvas shows only its error, no canvas", () => {
	const view = show({
		name: "edit_canvas",
		input: { target: { kind: "route", id: "r1" }, revision: 1, ops: [] },
		error: "response_9 is not on this canvas",
		status: "error",
	});
	const alert = view.getByRole("alert");
	expect(alert.textContent).toContain("response_9 is not on this canvas");
	expect(view.container.querySelector("[data-block-key]")).toBeNull();
});

test("load_tools, list_recordings and get_integration fold to a name, not raw JSON", () => {
	const load = showRow({
		name: "load_tools",
		input: { names: ["a", "b"] },
		output: { loaded: ["a", "b"], unknown: ["x"] },
	});
	expect(load.container.querySelector("summary")?.textContent).toContain("Loaded 2 tools");

	const recordings = showRow({
		name: "list_recordings",
		input: { kind: "route", targetId: "r1" },
		output: { items: [{ id: "0199aaaa-1111-7000-8000-000000000001" }], hasNext: false },
	});
	expect(recordings.container.querySelector("summary")?.textContent).toContain(
		"Listed 1 recording",
	);

	const integration = showRow({
		name: "get_integration",
		input: { projectId: "p1", integrationId: "i1" },
		output: { id: "i1", name: "Main DB", variant: "postgres" },
	});
	const text = integration.container.querySelector("summary")?.textContent ?? "";
	expect(text).toContain("Main DB");
	expect(text).not.toContain("{");

	const recording = showRow({
		name: "get_recording",
		input: { kind: "workflow", targetId: "w1", runId: "run9" },
		output: { id: "run9", outcome: "success", spans: [] },
	});
	expect(recording.container.querySelector("summary")?.textContent).toContain("workflow · success");
});

test("test_integration_connection folds and shows Success, or Failure with the reason", () => {
	const ok = showRow({
		name: "test_integration_connection",
		input: { projectId: "p1", integrationId: "i1" },
		output: { success: true },
	});
	expect(ok.container.querySelector("summary")?.textContent).toContain("Success");

	const badRow = showRow({
		name: "test_integration_connection",
		input: { projectId: "p1", integrationId: "i1" },
		output: { success: false, error: "password authentication failed" },
	});
	expect(badRow.container.querySelector("summary")?.textContent).toContain("Failure");

	const okBody = show({
		name: "test_integration_connection",
		input: { projectId: "p1", integrationId: "i1" },
		output: { success: true },
	});
	expect(okBody.container.textContent).toContain("Success");
	cleanup();

	const badBody = show({
		name: "test_integration_connection",
		input: { projectId: "p1", variant: "PostgreSQL", config: {} },
		output: { success: false, error: "password authentication failed" },
	});
	expect(badBody.getByRole("alert").textContent).toContain(
		"Failure: password authentication failed",
	);
	cleanup();

	const errored = show({
		name: "test_integration_connection",
		input: { projectId: "p1", integrationId: "i1" },
		error: "connection refused",
		status: "error",
	});
	expect(errored.container.textContent).toContain("Failure");
	expect(errored.getByRole("alert").textContent).toContain("connection refused");
});

test("save_app_config folds to a New / Update chip, the key and its value", () => {
	const created = showRow({
		name: "save_app_config",
		input: { projectId: "p1", keyName: "STRIPE_KEY", value: "sk-test", isEncrypted: false },
		output: { id: 7 },
	});
	const createdText = created.container.querySelector("summary")?.textContent ?? "";
	expect(createdText).toContain("New");
	expect(createdText).toContain("STRIPE_KEY");
	expect(createdText).toContain("= sk-test");
	cleanup();

	const updated = showRow({
		name: "save_app_config",
		input: {
			projectId: "p1",
			appConfigId: 7,
			keyName: "STRIPE_KEY",
			value: "sk-live",
			isEncrypted: false,
		},
		output: { id: 7 },
	});
	const updatedText = updated.container.querySelector("summary")?.textContent ?? "";
	expect(updatedText).toContain("Update");
	expect(updatedText).toContain("sk-live");
	cleanup();

	const secret = showRow({
		name: "save_app_config",
		input: {
			projectId: "p1",
			appConfigId: 7,
			keyName: "DB_PASS",
			value: "hunter2",
			isEncrypted: true,
		},
		output: { id: 7 },
	});
	const secretText = secret.container.querySelector("summary")?.textContent ?? "";
	expect(secretText).toContain("encrypted");
	expect(secretText).not.toContain("hunter2");
});

test("the agent's get folds to its type and id, never raw JSON", () => {
	const view = showRow({
		name: "get",
		input: { type: "integration", id: "i1" },
		output: { id: "i1", name: "Main DB", variant: "postgres" },
	});
	const text = view.container.querySelector("summary")?.textContent ?? "";
	expect(text).toContain("integration i1");
	expect(text).not.toContain("{");
});
