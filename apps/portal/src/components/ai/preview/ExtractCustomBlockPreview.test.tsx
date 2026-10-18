import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "../agentMessages";

GlobalRegistrator.register();

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

const { cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ExtractCustomBlockPreview, extractHeader } = await import("./ExtractCustomBlockPreview");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const input = {
	from: { kind: "sandbox", id: "s1" },
	fromName: "Draft",
	keys: ["jsrunner_1", "jsrunner_2"],
	name: "shout_text",
	label: "Shout text",
};
const done: ToolPart = {
	type: "tool",
	id: "t1",
	name: "extract_custom_block",
	input,
	output: { id: "cb1", name: "user_defined.p1.shout_text", instanceKey: "custom_shout_text_1" },
	status: "done",
} as ToolPart;

test("the header names the source, the count and the block's internal name", () => {
	expect(extractHeader(done)).toBe(
		"Extracted 2 blocks from Draft (sandbox) → Shout text (user_defined.p1.shout_text)",
	);
	expect(extractHeader({ ...done, output: undefined, status: undefined } as ToolPart, true)).toBe(
		"Extract 2 blocks from Draft (sandbox) → Shout text",
	);
});

test("the card shows the keys as chips and links the new block", () => {
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<ExtractCustomBlockPreview tool={done} asking={false} />
		</QueryClientProvider>,
	);
	expect(view.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
		"jsrunner_1",
		"jsrunner_2",
	]);
	expect(view.getByText("user_defined.p1.shout_text")).toBeTruthy();
	expect(view.getByText("custom_shout_text_1")).toBeTruthy();
	expect(view.container.querySelectorAll("a").length).toBeGreaterThanOrEqual(2);
});

test("asking with replace warns that the selection will be swapped", () => {
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<ExtractCustomBlockPreview
				tool={{ ...done, input: { ...input, replace: true }, output: undefined } as ToolPart}
				asking
			/>
		</QueryClientProvider>,
	);
	expect(view.getByText(/will be replaced/)).toBeTruthy();
});
