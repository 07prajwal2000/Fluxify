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
const { AgentMessage, StatusLine } = await import("./AgentMessage");

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

test("the status line names the phase and counts the seconds", () => {
	const phases = [
		["queued", "Queued…"],
		["waiting", "Waiting for model…"],
		["thinking", "Thinking…"],
	] as const;
	for (const [phase, label] of phases) {
		const r = render(<StatusLine phase={phase} since={Date.now() - 3000} />);
		expect(r.getByText(new RegExp(label))).toBeTruthy();
		expect(r.getByText(/3s/)).toBeTruthy();
		r.unmount();
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
	const line = r.getByText("Summarized 12 messages, 102k → 9k tokens");
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
			{
				type: "compaction",
				kind: "trim",
				results: 12,
				tools: { get_recording: 3, get_system_logs: 4, list_routes: 2, get_route: 3 },
				before: 41000,
				after: 12000,
			},
			"Trimmed 12 old tool results (get_system_logs ×4, get_recording ×3, get_route ×3, list_routes ×2), 41k → 12k tokens",
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

const LONG_WORD = `https://example.com/${"a".repeat(240)}`;

test("a long unbreakable word may break, in a user message and an assistant reply", () => {
	const user = show({ seq: 1, role: "user", parts: [{ type: "text", text: LONG_WORD }] });
	expect(user.getByText(LONG_WORD).className).toContain("[overflow-wrap:anywhere]");
	user.unmount();
	const reply = show({ seq: 2, role: "assistant", parts: [{ type: "text", text: LONG_WORD }] });
	expect(reply.getByText(LONG_WORD).closest("div")?.className).toContain(
		"[overflow-wrap:anywhere]",
	);
});
