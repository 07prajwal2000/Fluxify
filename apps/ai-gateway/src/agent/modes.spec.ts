import { describe, expect, it } from "bun:test";
import { type ModelMessage, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { type Approval, type PendingCall, runAgent } from "./agent";
import { limits, reply, run, text, usage } from "./modes.fixture";
import { cliApprover, converse, parseApproval, parseLine, parseStart } from "./cli";
import { describeCall, printRun } from "./progress";
import type { Mode } from "./tools";

describe("what asks", () => {
	it("manual asks for a save and call_route, not for a read", async () => {
		const r = await run([["get_canvas", "save_route", "call_route"]], "manual");
		expect(r.asked).toEqual(["save_route", "call_route"]);
		expect(r.ran.sort()).toEqual(["call_route", "get_canvas", "save_route"]);
	});

	it("auto runs saves and call_route unasked but asks for a delete", async () => {
		const r = await run([["save_route", "call_route", "run_test_suite", "delete_route"]], "auto");
		expect(r.asked).toEqual(["delete_route"]);
		expect(r.ran).toHaveLength(4);
	});

	it("run_blocks follows the project's ask setting: auto runs it unasked, unless the setting is on (#741)", async () => {
		const off = await run([["run_blocks"]], "auto");
		expect(off.asked).toEqual([]);
		expect(off.ran).toEqual(["run_blocks"]);

		const on = await run([["run_blocks"]], "auto", () => ({ ok: true }), {
			askBeforeEphemeralRuns: true,
		});
		expect(on.asked).toEqual(["run_blocks"]);
		expect(on.ran).toEqual(["run_blocks"]);
	});

	it("run_blocks asks in manual either way, and the setting changes no other tool", async () => {
		const manual = await run([["run_blocks"]], "manual");
		expect(manual.asked).toEqual(["run_blocks"]);

		const others = await run([["save_route", "call_route"]], "auto", () => ({ ok: true }), {
			askBeforeEphemeralRuns: true,
		});
		expect(others.asked).toEqual([]);
	});

	it("copy_blocks into a route asks every time, even in auto; into a sandbox it does not (#752)", async () => {
		const to = (t: unknown) => `copy_blocks|${JSON.stringify({ to: t })}`;
		const route = to({ kind: "route", id: "r" });
		const sandbox = to({ kind: "sandbox", id: "s" });
		const fresh = to("__new_sandbox__");
		expect((await run([[route, sandbox, fresh]], "auto")).asked).toEqual(["copy_blocks"]);
		expect((await run([[sandbox, fresh]], "manual")).asked).toHaveLength(2);
		// "always" on a copy into a sandbox never covers a copy into a route
		const always = (): Approval => ({ ok: true, always: true });
		const steps = [[sandbox], [sandbox, route], [route]];
		expect((await run(steps, "manual", always, { allowed: new Set() })).asked).toHaveLength(3);
	});

	it("a rejected run_blocks does not run", async () => {
		const r = await run([["run_blocks"]], "auto", () => ({ ok: false, reason: "not now" }), {
			askBeforeEphemeralRuns: true,
		});
		expect(r.ran).toEqual([]);
	});

	it("'always' skips later prompts for that tool, never for a delete", async () => {
		const allowed = new Set<string>();
		const always = (): Approval => ({ ok: true, always: true });
		const steps = [["save_route", "delete_route"], ["save_route", "delete_route"]];
		const r = await run(steps, "manual", always, { allowed });
		expect(r.asked).toEqual(["save_route", "delete_route", "delete_route"]);
		expect([...allowed]).toEqual(["save_route"]);
	});

	it("a rejection reason reaches the model as the tool result and the run goes on", async () => {
		const r = await run([["save_route"]], "manual", () => ({ ok: false, reason: "use /v2" }));
		expect(r.ran).toEqual([]);
		expect(r.prompts).toHaveLength(2);
		const last = r.prompts[1].messages.at(-1)!;
		expect(last.role).toBe("tool");
		expect(JSON.stringify(last.content)).toContain(
			"The user did not approve save_route: use /v2. Ask them, or continue without it.",
		);
		expect(r.shown).toContain("✗ save_route The user did not approve save_route: use /v2");
		expect(r.shown).toContain("done");
	});

	it("plan mode only exposes read tools", async () => {
		const r = await run([], "plan");
		expect(r.prompts[0].tools).toEqual(["get_canvas", "get_system_logs", "get"]);
		expect(JSON.stringify(r.prompts[0].messages)).toContain("Plan mode");
	});

	it("does not count the approval wait against the tool or model timeout", async () => {
		const slow = async (): Promise<Approval> => {
			await Bun.sleep(400);
			return { ok: true };
		};
		const r = await run([["save_route", "call_route"]], "manual", slow, { slowTool: 50 });
		expect(r.ran.sort()).toEqual(["call_route", "save_route"]);
		expect(r.shown).not.toContain("timed out");
		expect(r.shown).not.toContain("[error]");
		expect(r.shown).toMatch(/← save_route 0\.\ds/);
	});

	it("stopping during a prompt rejects the call and ends the run", async () => {
		const ctrl = new AbortController();
		const never = () => {
			setTimeout(() => ctrl.abort(new Error("Stopped by user")), 20);
			return new Promise<Approval>(() => {});
		};
		const r = await run([["save_route"]], "manual", never, { signal: ctrl.signal });
		expect(r.ran).toEqual([]);
		expect(r.prompts).toHaveLength(1);
		expect(r.shown).toContain("[stopped]");
	});
});

describe("cli answers", () => {
	it("reads /mode", () => {
		expect(parseLine("/mode auto")).toEqual({ mode: "auto" });
		expect(parseLine("/mode")).toEqual({ mode: undefined });
		expect(parseLine("/mode fast")).toEqual({ mode: "fast" });
		expect(parseLine("/exit")).toBe("exit");
	});

	it("reads an approval answer", () => {
		expect(parseApproval("y", false)).toEqual({ ok: true });
		expect(parseApproval(" A ", false)).toEqual({ ok: true, always: true });
		expect(parseApproval("a", true)).toBeUndefined();
		expect(parseApproval("n", false)).toEqual({ ok: false });
		expect(parseApproval("use /v2 instead", false)).toEqual({ ok: false, reason: "use /v2 instead" });
		expect(parseApproval("", false)).toBeUndefined();
	});

	it("reads Start?", () => {
		expect(parseStart("y")).toBe("start");
		expect(parseStart("N")).toBe("stay");
		expect(parseStart("")).toBeUndefined();
		expect(parseStart("also add auth")).toEqual({ changes: "also add auth" });
	});

	it("shows edit_canvas ops readably", () => {
		const s = describeCall("edit_canvas", {
			target: { kind: "route", id: "r1" },
			revision: 3,
			ops: [
				{ op: "add_block", ref: "a", type: "response", data: { status: 200 } },
				{ op: "connect", from: "entry", to: "a" },
				{ op: "remove_block", id: "b2" },
			],
		});
		expect(s).toContain("edit_canvas route r1 (v3)");
		expect(s).toContain("• add_block response a");
		expect(s).toContain("• connect entry → a");
		expect(s).toContain("• remove_block b2");
	});
});

describe("cli approver", () => {
	const call = (toolName: string, isDelete = false) => ({ toolCallId: "c", toolName, input: {}, isDelete });
	const setup = (answers: (string | null)[]) => {
		const prompts: string[] = [];
		const events: string[] = [];
		let shown = "";
		const approve = cliApprover(
			async (p) => {
				prompts.push(p);
				return answers.shift() ?? null;
			},
			(s) => (shown += s),
			(e) => events.push(e),
		);
		return { approve, prompts, events, shown: () => shown };
	};

	it("shows the call, offers a, and logs the wait", async () => {
		const s = setup(["", "a"]);
		expect(await s.approve(call("save_route"))).toEqual({ ok: true, always: true });
		expect(s.shown()).toContain("Approve save_route {}");
		expect(s.prompts).toEqual(["[y/n/a/reason] ", "[y/n/a/reason] "]);
		expect(s.events).toEqual(["approval-request", "approval-result"]);
	});

	it("does not offer a for a delete", async () => {
		const s = setup(["a", "y"]);
		expect(await s.approve(call("delete_route", true))).toEqual({ ok: true });
		expect(s.shown()).toContain("Delete delete_route");
		expect(s.prompts).toEqual(["[y/n/reason] ", "[y/n/reason] "]);
	});

	it("Ctrl+C at the prompt rejects", async () => {
		const s = setup([null]);
		expect(await s.approve(call("save_route"))).toEqual({ ok: false, reason: "stopped by the user" });
	});

	it("suggest_plan_mode asks y/n: y switches to plan, n goes on; both approve (#771)", async () => {
		for (const [answer, switched] of [["y", 1], ["n", 0]] as const) {
			const prompts: string[] = [];
			let toPlan = 0;
			const approve = cliApprover(
				async (p) => {
					prompts.push(p);
					return answer;
				},
				() => {},
				() => {},
				() => toPlan++,
			);
			const suggest = { toolCallId: "c", toolName: "suggest_plan_mode", input: { reason: "big job" }, isDelete: false };
			expect(await approve(suggest)).toEqual({ ok: true });
			expect(prompts).toEqual(["\nSwitch to plan mode? big job [y/n] "]);
			expect(toPlan).toBe(switched);
		}
	});
});

describe("plan then start", () => {
	const setup = (answers: NonNullable<ReturnType<typeof parseStart>>[]) => {
		const session = {
			history: [],
			mode: "plan" as Mode,
			allowed: new Set<string>(),
			loaded: new Set<string>(),
		};
		const runs: [string, Mode][] = [];
		const runOne = async (p: string) => {
			runs.push([p, session.mode]);
			return false;
		};
		let shown = "";
		const go = () => converse(session, "add /health", runOne, async () => answers.shift() ?? "stay", (s) => (shown += s));
		return { session, runs, go, shown: () => shown };
	};

	it("y runs the plan in auto and the session stays in auto", async () => {
		const s = setup(["start"]);
		await s.go();
		expect(s.runs).toEqual([
			["add /health", "plan"],
			["Go ahead with the plan.", "auto"],
		]);
		expect(s.session.mode).toBe("auto");
		expect(s.shown()).toContain("Mode: auto");
	});

	it("changes go back in plan mode and it asks again", async () => {
		const s = setup([{ changes: "also add auth" }, "stay"]);
		await s.go();
		expect(s.runs).toEqual([
			["add /health", "plan"],
			["also add auth", "plan"],
		]);
		expect(s.session.mode).toBe("plan");
	});

	it("n stays in plan without running", async () => {
		const s = setup(["stay"]);
		await s.go();
		expect(s.runs).toHaveLength(1);
		expect(s.session.mode).toBe("plan");
	});
});
