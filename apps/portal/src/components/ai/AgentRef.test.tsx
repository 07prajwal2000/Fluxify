import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1" }),
	Link: ({ to, search, children, ...rest }: any) => (
		<a href={search ? `${to}?q=${encodeURIComponent(search.q)}` : to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, render } = await import("@testing-library/react");
/** Not RTL's waitFor/screen: they stay bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 1500): Promise<T> {
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
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MarkdownViewer } = await import("./MarkdownViewer");
const { UserMessage } = await import("./UserMessage");
const { testSuitesService } = await import("@/services/testSuites");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const view = (ui: React.ReactElement) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{ui}
		</QueryClientProvider>,
	);
const links = () => [...document.querySelectorAll("a")];

test.each([
	["route", "r1", "/p1/canvas/r1"],
	["workflow", "w1", "/p1/workflow-canvas/w1"],
	["trigger", "t1", "/p1/triggers"],
	["custom_block", "b1", "/p1/custom-block-canvas/b1"],
	["middleware", "m1", "/p1/middlewares/m1"],
	["integration", "i1", "/p1/integrations/i1"],
	["app_config", "7", "/p1/app-config?q=Thing"],
])("a %s ref is a chip that opens its page in a new tab", (type, id, href) => {
	view(<MarkdownViewer content={`See :ref[Thing]{type=${type} id=${id}} now.`} />);
	const [a] = links();
	expect(a.textContent).toBe("Thing");
	expect(a.getAttribute("href")).toBe(href);
	expect(a.getAttribute("target")).toBe("_blank");
	expect(a.getAttribute("rel")).toContain("noopener");
	expect(a.querySelector("svg")).not.toBeNull();
	expect(document.body.textContent).toContain("See Thing now.");
});

test("a test suite opens the tests page of the route it belongs to", async () => {
	const get = spyOn(testSuitesService, "getById").mockResolvedValue({ routeId: "r9" } as never);
	view(<MarkdownViewer content=":ref[Smoke]{type=test_suite id=s1}" />);
	await until(() => expect(links()[0]?.getAttribute("href")).toBe("/p1/canvas/r9/test-suites"));
	get.mockResolvedValue({ workflowId: "w9" } as never);
	view(<MarkdownViewer content=":ref[Nightly]{type=test_suite id=s2}" />);
	await until(() =>
		expect(links()[1]?.getAttribute("href")).toBe("/p1/workflow-canvas/w9/test-suites"),
	);
	get.mockRestore();
});

test("user messages draw refs too, and so do old :resource chips", () => {
	view(
		<UserMessage
			query={
				'use :ref[GET /users]{type=route id=r1} and :resource{type="integration" identifier="i1" name="Main DB"}'
			}
		/>,
	);
	expect(links().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
		["GET /users", "/p1/canvas/r1"],
		["Main DB", "/p1/integrations/i1"],
	]);
});

test.each([
	["an unknown type", ":ref[Thing]{type=banana id=1}"],
	["a missing id", ":ref[Thing]{type=route}"],
	["no attributes", ":ref[Thing]"],
])("%s is plain text, not a link, and does not crash", (_name, content) => {
	view(<MarkdownViewer content={`before ${content} after`} />);
	expect(links()).toHaveLength(0);
	expect(document.body.textContent).toContain("before Thing after");
});

test("a test suite that cannot be read falls back to its label", async () => {
	const get = spyOn(testSuitesService, "getById").mockRejectedValue(new Error("404"));
	view(<MarkdownViewer content="x :ref[Gone]{type=test_suite id=nope} y" />);
	await until(() => expect(get).toHaveBeenCalled());
	await until(() => expect(links()).toHaveLength(0));
	expect(document.body.textContent).toContain("x Gone y");
	get.mockRestore();
});

test("a half-typed ref while streaming stays text", () => {
	view(<MarkdownViewer content="see :ref[Thi" />);
	expect(links()).toHaveLength(0);
	expect(document.body.textContent).toContain("see :ref[Thi");
});
