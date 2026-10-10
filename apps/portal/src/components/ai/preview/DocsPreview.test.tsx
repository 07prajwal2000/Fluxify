import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "../agentMessages";

GlobalRegistrator.register();
mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1" }),
	Link: ({ to, children, search: _s, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ToolBody } = await import("./ToolBody");
const { ToolRow } = await import("../ToolRow");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const tool = (t: Partial<ToolPart> & { name: string }): ToolPart => ({
	type: "tool",
	id: "t",
	input: {},
	status: "done",
	...t,
});
const show = (t: ToolPart) =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ToolBody tool={t} asking={false} />
		</QueryClientProvider>,
	);

test("read_doc: the page and section as plain text, the answer as markdown", () => {
	const view = show(
		tool({
			name: "read_doc",
			input: { page: "concepts/triggers", heading: "Cron" },
			output:
				"[page: concepts/triggers | Triggers > Cron]\n\n## Cron\n\nRuns on a **schedule**.\n\n- one\n- two",
		}),
	);
	expect(view.container.textContent).toContain("concepts/triggers › Cron");
	expect(view.container.querySelector("strong")?.textContent).toBe("schedule");
	expect([...view.container.querySelectorAll("li")].map((l) => l.textContent)).toEqual([
		"one",
		"two",
	]);
	// Raw has the same plain line, not JSON
	fireEvent.click(view.getByRole("tab", { name: "Raw" }));
	expect(view.container.textContent).toContain("concepts/triggers › Cron");
	expect(view.container.textContent).not.toContain('"page"');
});

test("search_docs: keywords as a comma separated line, also in the folded row", () => {
	const t = tool({
		name: "search_docs",
		input: { queries: ["cron trigger", "retry"] },
		output: "[page: a | A > B]\n\ntext\n\n---\n\n[page: c | C > D]\n\nmore",
	});
	const view = show(t);
	expect(view.container.textContent).toContain("cron trigger, retry");
	cleanup();
	const row = render(
		<QueryClientProvider client={new QueryClient()}>
			<ToolRow tool={t} waiting={false} running={false} />
		</QueryClientProvider>,
	);
	expect(row.container.textContent).toContain("cron trigger, retry");
	expect(row.container.textContent).not.toContain("queries");
});

test("test_integration_connection: connected, or the reason it failed, with a link when saved", () => {
	const ok = show(
		tool({
			name: "test_integration_connection",
			input: { projectId: "p1", integrationId: "i1" },
			output: { success: true },
		}),
	);
	expect(ok.container.textContent).toContain("Connected");
	expect(ok.container.querySelector('a[href="/p1/integrations/i1"]')).not.toBeNull();
	cleanup();
	const bad = show(
		tool({
			name: "test_integration_connection",
			input: { projectId: "p1", variant: "PostgreSQL", config: {} },
			output: { success: false, error: "password authentication failed" },
		}),
	);
	expect(bad.getByRole("alert").textContent).toContain("password authentication failed");
	expect(bad.container.textContent).toContain("PostgreSQL");
});
