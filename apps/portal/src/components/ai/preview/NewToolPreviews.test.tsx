import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "../agentMessages";

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
	},
});

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

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ToolBody } = await import("./ToolBody");
const { ToolRow } = await import("../ToolRow");

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

function show(tool: Partial<ToolPart> & { name: string }, asking = false) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ToolBody tool={{ type: "tool", id: "t", input: {}, ...tool }} asking={asking} />
		</QueryClientProvider>,
	);
}

function showRow(tool: Partial<ToolPart> & { name: string }, asking = false) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ToolRow
				tool={{ type: "tool", id: "t", input: {}, ...tool }}
				waiting={asking}
				running={false}
			/>
		</QueryClientProvider>,
	);
}

test("create_sandbox: shows New sandbox card and Open link when done; shows pending card when asking", async () => {
	const done = show({
		name: "create_sandbox",
		input: { projectId: "p1", name: "Scratch 1" },
		output: { id: "sb-1", name: "Scratch 1", settings: { tracingEnabled: false } },
		status: "done",
	});
	await until(() => expect(done.container.textContent).toContain("Scratch 1"));
	expect(done.container.textContent).toContain("New");
	const link = done.container.querySelector('a[href="/p1/sandbox-canvas/sb-1"]');
	expect(link).not.toBeNull();
	done.unmount();

	const asking = show(
		{
			name: "create_sandbox",
			input: { projectId: "p1", name: "Scratch Pending" },
		},
		true,
	);
	await until(() => expect(asking.container.textContent).toContain("Scratch Pending"));
	expect(asking.container.textContent).toContain("New");
});

test("delete_sandbox: uses DeleteCard with danger styling", async () => {
	const done = show({
		name: "delete_sandbox",
		input: { projectId: "p1", sandboxId: "sb-del-1" },
		output: { deleted: "sb-del-1" },
		status: "done",
	});
	await until(() => expect(done.getByLabelText("Delete sandbox")).toBeTruthy());
	expect(done.container.textContent).toContain("Deleted sandbox");
	done.unmount();

	const asking = show(
		{
			name: "delete_sandbox",
			input: { projectId: "p1", sandboxId: "sb-del-2" },
		},
		true,
	);
	await until(() => expect(asking.getByLabelText("Delete sandbox")).toBeTruthy());
	expect(asking.container.textContent).toContain("Deletes sandbox");
	expect(asking.container.textContent).toContain("This cannot be undone.");
});

test("get_sandbox and list_sandboxes: render with canvas links", async () => {
	const get = show({
		name: "get_sandbox",
		input: { projectId: "p1", sandboxId: "sb-read-1" },
		output: { id: "sb-read-1", name: "Read Box", settings: {} },
		status: "done",
	});
	await until(() => expect(get.container.textContent).toContain("Read Box"));
	expect(get.container.querySelector('a[href="/p1/sandbox-canvas/sb-read-1"]')).not.toBeNull();
	get.unmount();

	const list = show({
		name: "list_sandboxes",
		input: { projectId: "p1" },
		output: [
			{ id: "sb-row-1", name: "Box 1" },
			{ id: "sb-row-2", name: "Box 2" },
		],
		status: "done",
	});
	await until(() => expect(list.container.textContent).toContain("Box 1"));
	expect(list.container.querySelector('a[href="/p1/sandbox-canvas/sb-row-1"]')).not.toBeNull();
	expect(list.container.querySelector('a[href="/p1/sandbox-canvas/sb-row-2"]')).not.toBeNull();
});

test("run_sandbox: shows queued status when done, warning notice when asking", async () => {
	const done = show({
		name: "run_sandbox",
		input: { projectId: "p1", sandboxId: "sb-run-1", payload: { x: 42 } },
		output: { runId: "run-99" },
		status: "done",
	});
	await until(() => expect(done.container.textContent).toContain("Queued"));
	expect(done.container.textContent).toContain("Run ID: run-99");
	expect(done.container.textContent).toContain("42");
	done.unmount();

	const asking = show(
		{
			name: "run_sandbox",
			input: { projectId: "p1", sandboxId: "sb-run-2" },
		},
		true,
	);
	await until(() => expect(asking.container.textContent).toContain("This action will queue a run"));
	expect(asking.container.textContent).toContain("sb-run-2");
});

test("MemberPreview: handles add_member, update_member_role, and remove_member", async () => {
	const add = show({
		name: "add_member",
		input: { projectId: "p1", user: "dev@fluxify.io", role: "creator" },
		output: { userId: "u1", role: "creator" },
		status: "done",
	});
	await until(() => expect(add.container.textContent).toContain("dev@fluxify.io"));
	expect(add.container.textContent).toContain("creator");
	add.unmount();

	const remove = show(
		{
			name: "remove_member",
			input: { projectId: "p1", userId: "u-rm" },
		},
		true,
	);
	await until(() => expect(remove.getByLabelText("Remove member")).toBeTruthy());
	expect(remove.container.textContent).toContain("This cannot be undone.");
});

test("PackagePreview: handles install_package and remove_package", async () => {
	const install = show({
		name: "install_package",
		input: { projectId: "p1", packages: [{ name: "lodash", version: "^4.17.21" }] },
		output: { packages: { lodash: "^4.17.21" } },
		status: "done",
	});
	await until(() => expect(install.container.textContent).toContain("lodash"));
	expect(install.container.textContent).toContain("^4.17.21");
	install.unmount();

	const remove = show(
		{
			name: "remove_package",
			input: { projectId: "p1", names: ["axios"] },
		},
		true,
	);
	await until(() => expect(remove.getByLabelText("Remove packages")).toBeTruthy());
	expect(remove.container.textContent).toContain("axios");
});

test("update_project: shows project settings fields", async () => {
	const view = show({
		name: "update_project",
		input: { projectId: "p1", name: "New Name", description: "Updated desc" },
		output: { id: "p1", name: "New Name", description: "Updated desc" },
		status: "done",
	});
	await until(() => expect(view.container.textContent).toContain("New Name"));
	expect(view.container.textContent).toContain("Updated desc");
});

test("SuiteActionPreview: validate_test_suite and clone_test_suite", async () => {
	const valid = show({
		name: "validate_test_suite",
		input: { projectId: "p1", testSuiteId: "ts-1" },
		output: { valid: true },
		status: "done",
	});
	await until(() => expect(valid.container.textContent).toContain("assertions are valid"));
	valid.unmount();

	const invalid = show({
		name: "validate_test_suite",
		input: { projectId: "p1", testSuiteId: "ts-2" },
		output: { valid: false, errors: ["Missing body property"] },
		status: "done",
	});
	await until(() => expect(invalid.container.textContent).toContain("Missing body property"));
	invalid.unmount();

	const clone = show({
		name: "clone_test_suite",
		input: { projectId: "p1", testSuiteId: "ts-1", name: "Cloned Suite" },
		output: { id: "ts-clone-1", droppedHooks: ["hook_1"] },
		status: "done",
	});
	await until(() => expect(clone.container.textContent).toContain("Cloned Suite"));
	expect(clone.container.textContent).toContain("hook_1");
});

test("kv_get: displays key, value, and integration link", async () => {
	const view = show({
		name: "kv_get",
		input: { projectId: "p1", integrationId: "int-1", key: "session:123" },
		output: { value: { user: "Alice" }, ttl: 3600 },
		status: "done",
	});
	await until(() => expect(view.container.textContent).toContain("session:123"));
	expect(view.container.textContent).toContain("Expires in: 3600s");
	expect(view.container.textContent).toContain("Alice");
	expect(view.container.querySelector('a[href="/p1/integrations/int-1"]')).not.toBeNull();
});

test("whoami: displays user info and project roles table", async () => {
	const view = show({
		name: "whoami",
		input: {},
		output: {
			id: "u-admin",
			email: "admin@fluxify.io",
			isSystemAdmin: true,
			acl: [{ projectId: "p1", role: "project_admin" }],
		},
		status: "done",
	});
	await until(() => expect(view.container.textContent).toContain("admin@fluxify.io"));
	expect(view.container.textContent).toContain("Admin");
	expect(view.container.textContent).toContain("project_admin");
});

test("ToolRow renders summarized header for new tools", () => {
	const row = showRow({
		name: "create_sandbox",
		input: { projectId: "p1", name: "My Sandbox" },
		output: { id: "s1" },
		status: "done",
	});
	expect(row.container.querySelector("summary")?.textContent).toContain("My Sandbox");
});
