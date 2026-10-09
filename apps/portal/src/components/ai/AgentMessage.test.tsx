import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ChatMessage } from "./agentMessages";

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

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { AgentMessage } = await import("./AgentMessage");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const show = (message: ChatMessage) =>
	render(<AgentMessage message={message} waiting={false} running={false} />);
const thought = (ms?: number): ChatMessage => ({
	seq: 1,
	role: "assistant",
	parts: [{ type: "reasoning", text: "hmm", ms }],
});

test("a finished thought shows its own time; a blink or an unknown time shows none", () => {
	const a = show(thought(42_400));
	expect(a.getByText("Thought for 42s")).toBeTruthy();
	a.unmount();
	for (const ms of [undefined, 300]) {
		const b = show(thought(ms));
		expect(b.getByText("Thought")).toBeTruthy();
		b.unmount();
	}
});

test("a saved summary is a quiet line that opens to the summary", () => {
	const r = show({
		seq: 3,
		role: "compaction",
		parts: [],
		summary: "Summary of the earlier conversation:\nbuilt the users route",
		compaction: {
			type: "compaction",
			kind: "summary",
			messages: 12,
			coversUpTo: 12,
			before: 102_000,
			after: 9000,
		},
	});
	const line = r.getByText("Context compacted: 102k → 9k tokens");
	const details = line.closest("details") as HTMLDetailsElement;
	expect(details.open).toBe(false);
	expect(details.textContent).toContain("built the users route");
	fireEvent.click(line);
	expect(r.container.querySelector("details")).toBe(details);
});

test("a summary saved before the numbers were kept, a trim and a failure each have a line", () => {
	const lines: [ChatMessage["compaction"], string][] = [
		[undefined, "Context compacted"],
		[
			{ type: "compaction", kind: "trim", results: 12, savedTokens: 5000 },
			"Trimmed 12 old tool results",
		],
		[{ type: "compaction", kind: "summary-failed", error: "boom" }, "Compaction failed: boom"],
	];
	for (const [compaction, text] of lines) {
		const r = show({
			seq: 1,
			role: "compaction",
			parts: [],
			compaction,
			summary: compaction ? undefined : "x",
		});
		expect(r.getByText(text)).toBeTruthy();
		r.unmount();
	}
});
