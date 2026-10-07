import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// compile status polls the server; nothing here is about compiling
mock.module("./diagnostics/useCompileDiagnostics", () => ({
	useCompileDiagnostics: () => ({
		baseline: async () => undefined,
		waitForCompile: async () => null,
	}),
}));

const { cleanup, render, renderHook } = await import("@testing-library/react");
const { authStore, useCanEditProject } = await import("@/store/auth");
const { CanvasWorkbench } = await import("./CanvasWorkbench");

afterEach(() => {
	cleanup();
	authStore.setState((s) => {
		s.state.acl = {};
		s.state.userData = { id: "", name: "", email: "" };
	});
});
afterAll(() => GlobalRegistrator.unregister());

function signIn(
	acl: Record<string, "viewer" | "creator" | "project_admin">,
	isSystemAdmin = false,
) {
	authStore.setState((s) => {
		s.state.acl = acl;
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin };
	});
}

const canEdit = (projectId: string) =>
	renderHook(() => useCanEditProject(projectId)).result.current;

test("only creator and above may edit a project", () => {
	signIn({ p1: "viewer", p2: "creator", p3: "project_admin" });
	expect(canEdit("p1")).toBe(false);
	expect(canEdit("p2")).toBe(true);
	expect(canEdit("p3")).toBe(true);
	expect(canEdit("other")).toBe(false);
});

test("a system admin may edit any project", () => {
	signIn({}, true);
	expect(canEdit("anything")).toBe(true);
});

// queries come from render(), not `screen`: in a shared test process `screen`
// can still point at an earlier file's document
function renderWorkbench(readOnly: boolean) {
	return render(
		<CanvasWorkbench
			title="Route canvas"
			readOnly={readOnly}
			items={{ data: undefined, isLoading: true, isError: false, refetch: async () => {} }}
			compileTarget={{ projectId: "p1", resourceType: "route", resourceId: "r1" }}
			reload={async () => ({ canvasVersion: 0, blocks: [], edges: [] })}
			getVersion={async () => 0}
			save={async () => {}}
		/>,
	);
}

test("read-only workbench has no Save button", () => {
	const view = renderWorkbench(true);
	expect(view.getByText("Route canvas")).toBeTruthy();
	expect(view.queryByRole("button", { name: "Save" })).toBeNull();
});

test("editable workbench keeps its Save button", () => {
	const view = renderWorkbench(false);
	expect(view.getByRole("button", { name: "Save" })).toBeTruthy();
});
