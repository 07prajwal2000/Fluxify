import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "../agentMessages";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1" }),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ResourceCard } = await import("./ResourceCard");
const { DeleteCard } = await import("./DeleteCard");
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
const wrap = (ui: React.ReactElement) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{ui}
		</QueryClientProvider>,
	);
const tool = (name: string, input: object, extra: Partial<ToolPart> = {}): ToolPart => ({
	type: "tool",
	id: "t1",
	name,
	input,
	...extra,
});

test("a new route is a card with its method, path and every field, marked New", () => {
	const read = spyOn(agentConversationsService, "resourcePreview");
	const view = wrap(
		<ResourceCard
			asking
			tool={tool("save_route", {
				projectId: "p1",
				name: "List users",
				method: "GET",
				path: "/users",
				active: true,
			})}
		/>,
	);
	const text = view.container.textContent;
	expect(text).toContain("List users");
	expect(text).toContain("GET /users");
	expect(text).toContain("New");
	expect(view.container.querySelectorAll("ins").length).toBeGreaterThan(0);
	// a create has nothing saved yet to compare with
	expect(read).not.toHaveBeenCalled();
	read.mockRestore();
});

test("an update shows only the fields that differ from what is saved, and a link to open it", async () => {
	const read = spyOn(agentConversationsService, "resourcePreview").mockResolvedValue({
		current: { id: "r1", name: "List users", method: "GET", path: "/users", active: false },
	});
	const view = wrap(
		<ResourceCard
			asking
			tool={tool("save_route", { routeId: "r1", path: "/people", active: false })}
		/>,
	);
	await until(() => expect(view.container.querySelector("del")?.textContent).toBe("/users"));
	expect(view.container.querySelector("ins")?.textContent).toBe("/people");
	expect(view.getByText("Update")).toBeTruthy();
	// active did not change: one struck-out value only
	expect(view.container.querySelectorAll("del")).toHaveLength(1);
	const link = view.getByRole("link", { name: "Open" });
	expect(link.getAttribute("href")).toBe("/p1/canvas/r1");
	expect(link.getAttribute("target")).toBe("_blank");
	expect(read).toHaveBeenCalledWith("p1", "save_route", {
		routeId: "r1",
		path: "/people",
		active: false,
	});
	read.mockRestore();
});

test("secrets are masked: a password in a config, and the value of an encrypted app config", async () => {
	const read = spyOn(agentConversationsService, "resourcePreview").mockResolvedValue({
		current: { id: "i1", name: "Main DB", config: { host: "db", password: "old-pass" } },
	});
	const a = wrap(
		<ResourceCard
			asking
			tool={tool("save_integration", {
				integrationId: "i1",
				config: { host: "db", password: "new-pass" },
			})}
		/>,
	);
	// the config object is an indented diff now, not one line
	await until(() => expect(a.container.textContent).toContain("host"));
	expect(a.container.textContent).not.toContain("new-pass");
	expect(a.container.textContent).not.toContain("old-pass");
	expect(a.container.textContent).toContain("••••••••");
	a.unmount();

	const b = wrap(
		<ResourceCard
			asking
			tool={tool("save_app_config", {
				projectId: "p1",
				keyName: "STRIPE_KEY",
				value: "plain-value",
				isEncrypted: true,
			})}
		/>,
	);
	expect(b.container.textContent).toContain("STRIPE_KEY");
	expect(b.container.textContent).not.toContain("plain-value");
	expect(b.container.textContent).toContain("••••••••");
	read.mockRestore();
});

test("a saved create links to what it made, by the id in the result", () => {
	const view = wrap(
		<ResourceCard
			asking={false}
			tool={tool(
				"save_workflow",
				{ projectId: "p1", name: "Nightly" },
				{ output: { id: "w9" }, status: "done" },
			)}
		/>,
	);
	expect(view.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
		"/p1/workflow-canvas/w9",
	);
});

test("a delete card says what goes, in danger colours, with the route's method and path", async () => {
	const read = spyOn(agentConversationsService, "resourcePreview").mockResolvedValue({
		current: { id: "r1", name: "List users", method: "GET", path: "/users" },
	});
	const view = wrap(<DeleteCard asking tool={tool("delete_route", { routeId: "r1" })} />);
	await until(() => expect(view.getByText("List users")).toBeTruthy());
	const card = view.getByLabelText("Delete route");
	expect(card.className).toContain("border-danger");
	expect(card.textContent).toContain("Deletes route");
	expect(card.textContent).toContain("GET /users");
	expect(card.textContent).toContain("This cannot be undone.");
	read.mockRestore();
});

test("a delete card still names what goes when it cannot be read, and reads 'Deleted' once done", () => {
	const a = wrap(
		<DeleteCard asking tool={tool("delete_trigger", { triggerId: "abcdef123456" })} />,
	);
	expect(a.getByLabelText("Delete trigger").textContent).toContain("trigger abcdef12");
	a.unmount();
	const b = wrap(
		<DeleteCard
			asking={false}
			tool={tool(
				"delete_trigger",
				{ triggerId: "t1" },
				{ output: { deleted: "t1" }, status: "done" },
			)}
		/>,
	);
	expect(b.getByLabelText("Delete trigger").textContent).toContain("Deleted trigger");
	expect(b.getByLabelText("Delete trigger").textContent).not.toContain("cannot be undone");
});
