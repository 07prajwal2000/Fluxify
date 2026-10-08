import { describe, expect, it } from "bun:test";
import type { Limit } from "./agent";
import { cliLimit, limitPrompt, parseYesNo } from "./cli";
import { distinct, looping, nextRequestIsValid, run } from "./guards.fixture";
import { capResult, guardTools, newGuard, stableKey, WRAP_UP } from "./guards";

describe("repeat guard", () => {
	it("nudges the same read at 3, stops it at 5 with a note, and the next request stays valid", async () => {
		const r = await run(Array(8).fill({ q: "a", page: 1 }));
		expect(r.prompts).toHaveLength(5);
		expect(looping(r)).toEqual([false, false, true, true, true]);
		expect(r.shown).toContain("[stopped] repeated get_canvas 5 times");
		expect(r.stopped).toEqual({ kind: "repeat", tool: "get_canvas" });
		expect(JSON.stringify(r.history.at(-1)?.content)).toContain("(stopped: repeated get_canvas 5 times");
		nextRequestIsValid(r.history);
	});

	it("matches args whatever their key order", async () => {
		expect(stableKey({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(stableKey({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }));
		const r = await run([{ q: "a", page: 1 }, { page: 1, q: "a" }, { q: "a", page: 1 }]);
		expect(r.results[2]).toContain("You are looping");
		expect(r.results[2]).toContain("get_canvas call (args: ");
	});

	it("counts the same read error with different args", async () => {
		const r = await run(distinct(8), { fail: "Route not found" });
		expect(r.prompts).toHaveLength(5);
		expect(r.results[2]).toContain("get_canvas call (failed with: Route not found)");
		expect(r.stopped).toEqual({ kind: "repeat", tool: "get_canvas" });
	});

	it("leaves different reads alone", async () => {
		const r = await run(distinct(8));
		expect(r.prompts).toHaveLength(9);
		expect(looping(r).some(Boolean)).toBe(false);
		expect(r.stopped).toBeUndefined();
		expect(r.shown).not.toContain("[stopped]");
	});
});

describe("step cap", () => {
	it("stops with a note when onLimit says no", async () => {
		const r = await run(distinct(10), { maxSteps: 3, onLimit: () => false });
		expect(r.limitsAsked).toEqual([{ kind: "steps", used: 3, limit: 3 }]);
		expect(r.prompts).toHaveLength(3);
		expect(r.shown).toContain("[stopped] reached the 3-step limit");
		expect(r.history.at(-1)).toEqual({ role: "assistant", content: "(stopped: reached the 3-step limit before finishing)" });
		nextRequestIsValid(r.history);
	});

	it("Ctrl+C at the prompt (the run is aborted) still leaves the note", async () => {
		const ctrl = new AbortController();
		const ctrlC = () => {
			setTimeout(() => ctrl.abort(new Error("Stopped by user")), 10);
			return new Promise<boolean>(() => {});
		};
		const r = await run(distinct(10), { maxSteps: 2, onLimit: ctrlC, signal: ctrl.signal });
		expect(r.history.at(-1)).toEqual({ role: "assistant", content: "(stopped: reached the 2-step limit before finishing)" });
		nextRequestIsValid(r.history);
	});

	it("stops without a callback", async () => {
		const r = await run(distinct(10), { maxSteps: 2 });
		expect(r.prompts).toHaveLength(2);
		expect(r.stopped).toEqual({ kind: "steps", used: 2, limit: 2 });
	});

	it("grants another block of steps when onLimit says yes", async () => {
		const r = await run(distinct(5), { maxSteps: 2, onLimit: () => true });
		expect(r.limitsAsked).toEqual([
			{ kind: "steps", used: 2, limit: 2 },
			{ kind: "steps", used: 4, limit: 4 },
		]);
		expect(r.prompts).toHaveLength(6);
		expect(r.shown).toContain("done");
		expect(r.stopped).toBeUndefined();
	});
});

describe("token budget", () => {
	// Every step uses 2 tokens: 80% of 10 is reached after step 4, the budget after step 5.
	it("warns once at 80%, then asks at 100% and stops on no", async () => {
		const r = await run(distinct(10), { tokenBudget: 10, onLimit: () => false });
		expect(r.results.map((s) => s.includes("80% of this run's token budget"))).toEqual([false, false, false, false, true]);
		expect(r.limitsAsked).toEqual([{ kind: "tokens", used: 10, limit: 10 }]);
		expect(r.shown).toContain("[stopped] reached the 10-token budget (10 used)");
		expect(r.history.at(-1)).toEqual({ role: "assistant", content: "(stopped: used 10 of the 10-token budget before finishing)" });
		nextRequestIsValid(r.history);
	});

	it("does not warn again after a yes", async () => {
		const r = await run(distinct(9), { tokenBudget: 10, onLimit: () => true });
		expect(r.results.filter((s) => s.includes("80%"))).toHaveLength(1);
		expect(r.limitsAsked).toEqual([{ kind: "tokens", used: 10, limit: 10 }]);
		expect(r.shown).toContain("done");
	});
});

describe("result cap", () => {
	const big = Array.from({ length: 5000 }, (_, i) => ({ id: `route-${i}`, path: `/r/${i}` }));

	it("keeps the start and end of a big list with a marker in the middle", () => {
		const s = capResult("list", big, 1000) as string;
		const json = JSON.stringify(big);
		expect(s.startsWith(json.slice(0, 500))).toBe(true);
		expect(s.endsWith(json.slice(-500))).toBe(true);
		expect(s).toContain(`${json.length - 1000} chars cut. Narrow the request`);
		expect(s.length).toBeLessThan(1200);
		expect(capResult("list", "short", 1000)).toBe("short");
	});

	it("never cuts a canvas", () => {
		expect(capResult("get_canvas", big, 1000)).toBe(big);
		expect(capResult("edit_canvas", big, 1000)).toBe(big);
	});

	it("applies to every tool through the wrapper", async () => {
		const t = { execute: async () => big } as any;
		const g = guardTools({ list: t, get_canvas: t }, newGuard(), 1000);
		expect(await g.list.execute!({}, {} as any)).toContain("chars cut");
		expect(await g.get_canvas.execute!({}, {} as any)).toBe(big);
	});

	it("puts a pending note on the next result", async () => {
		const guard = newGuard();
		guard.pending.push(WRAP_UP);
		const g = guardTools({ get: { execute: async () => ({ id: 1 }) } as any }, guard, 1000);
		expect(await g.get.execute!({ a: 1 }, {} as any)).toEqual({ result: { id: 1 }, note: WRAP_UP });
		expect(await g.get.execute!({ a: 2 }, {} as any)).toEqual({ id: 1 });
	});
});

describe("cli continue prompt", () => {
	it("reads y/n", () => {
		expect(parseYesNo(" Y ")).toBe(true);
		expect(parseYesNo("yes")).toBe(true);
		expect(parseYesNo("n")).toBe(false);
		expect(parseYesNo("")).toBeUndefined();
		expect(parseYesNo("maybe")).toBeUndefined();
	});

	it("says which limit was hit", () => {
		expect(limitPrompt({ kind: "steps", used: 40, limit: 40 })).toBe("Reached the 40-step limit. Continue? [y/n] ");
		expect(limitPrompt({ kind: "tokens", used: 1002345, limit: 1000000 })).toBe(
			"Reached the token budget (1,002,345 / 1,000,000 tokens). Continue? [y/n] ",
		);
	});

	const ask = (answers: (string | null)[]) => {
		const prompts: string[] = [];
		const onLimit = cliLimit(
			async (p) => {
				prompts.push(p);
				return answers.shift() ?? null;
			},
			() => {},
			() => {},
		);
		return { onLimit, prompts };
	};
	const steps: Limit = { kind: "steps", used: 40, limit: 40 };

	it("asks until it gets y or n", async () => {
		const a = ask(["", "sure", "y"]);
		expect(await a.onLimit(steps)).toBe(true);
		expect(a.prompts).toHaveLength(3);
		expect(await ask(["n"]).onLimit(steps)).toBe(false);
	});

	it("Ctrl+C is no", async () => {
		expect(await ask([null]).onLimit(steps)).toBe(false);
	});
});
