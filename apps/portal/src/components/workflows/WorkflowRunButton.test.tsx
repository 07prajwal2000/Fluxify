import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { authStore } = await import("@/store/auth");
const { WorkflowRunButton } = await import("./WorkflowRunModal");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function renderAs(role: "viewer" | "creator", active = true) {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
	const view = render(<WorkflowRunButton projectId="p1" active={active} onPress={() => {}} />);
	return view.getByRole("button", { name: "Run" });
}

test("a viewer cannot run a workflow", () => {
	expect(renderAs("viewer").hasAttribute("disabled")).toBe(true);
});

test("a creator can run an active workflow, not an inactive one", () => {
	expect(renderAs("creator").hasAttribute("disabled")).toBe(false);
	cleanup();
	expect(renderAs("creator", false).hasAttribute("disabled")).toBe(true);
});
