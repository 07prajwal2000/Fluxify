import { describe, expect, it } from "bun:test";
import { run, type Step } from "./guards.fixture";

const same: Step[] = [{ id: "r1" }, { id: "r1" }, { id: "r1" }, { id: "r1" }];
const opts = (p: string) => ({ provider: p, cacheRead: 7 });
const cached = (m: any) => m.providerOptions?.anthropic?.cacheControl?.type === "ephemeral";

describe("prompt cache", () => {
	it("anthropic: breakpoint on the system prompt and the last message only", async () => {
		const r = await run(same, opts("anthropic.messages"));
		expect(r.prompts.length).toBeGreaterThan(3);
		for (const p of r.prompts) {
			expect(cached(p[0])).toBe(true);
			expect(cached(p.at(-1))).toBe(true);
			expect(p.filter(cached)).toHaveLength(2);
		}
	});

	it("the budget line goes after the breakpoint, so the cached prefix stays the same", async () => {
		const r = await run(same, opts("anthropic.messages"));
		for (const p of r.raw) {
			expect(JSON.stringify(p.at(-1))).toContain("Budget: step");
			expect(cached(p.at(-1))).toBe(false);
			expect(cached(p.at(-2))).toBe(true);
		}
		// what comes before the budget line does not mention it
		expect(JSON.stringify(r.prompts)).not.toContain("Budget:");
	});

	it.each(["openai.responses", "google.generative-ai", "openai-compatible.chat"])(
		"%s: no cache control",
		async (provider) => {
			const r = await run(same, opts(provider));
			for (const p of r.prompts) expect(p.some(cached)).toBe(false);
		},
	);

	it.each(["anthropic.messages", "openai.responses"])(
		"%s: system prompt is byte-identical every step, also after a loop warning",
		async (provider) => {
			const r = await run(same, opts(provider));
			expect(r.results.some((s) => s.includes("You are looping"))).toBe(true);
			const system = r.prompts.map((p) => JSON.stringify(p.filter((m) => m.role === "system")));
			expect(new Set(system).size).toBe(1);
			expect(system[0]).toContain("Fluxify agent");
		},
	);

	it("sums cache read tokens into the log and the summary", async () => {
		const events: [string, any][] = [];
		const r = await run(same.slice(0, 2), { cacheRead: 5, log: (e, d) => events.push([e, d]) });
		const steps = events.filter(([e]) => e === "step-end");
		expect(steps.map(([, d]) => d.cacheReadTokens)).toEqual([5, 5, 5]);
		expect(events.find(([e]) => e === "run-end")?.[1].cacheReadTokens).toBe(15);
		expect(r.shown).toContain("[cache: 15 read / 0 written]");
	});
});
