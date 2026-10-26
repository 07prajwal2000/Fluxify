import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { IntegrationRegistry, runIntegrationHook } from "..";

const seen: Array<AbortSignal | undefined> = [];
const registry = new IntegrationRegistry();
registry.register({
	group: "acme/crm",
	variant: "Hub",
	label: "Hub",
	configSchema: z.object({ mode: z.string() }),
	async test(config: { mode: string }, ctx: { signal?: AbortSignal }) {
		seen.push(ctx.signal);
		if (config.mode === "hang") return new Promise(() => {});
		return { success: true, error: "" };
	},
} as never);

const run = (mode: string, signal?: AbortSignal, timeoutMs = 5_000) =>
	runIntegrationHook(
		registry,
		"test",
		{ group: "acme/crm", variant: "Hub", config: { mode } },
		() => new Map(),
		timeoutMs,
		signal,
	);

describe("runIntegrationHook, cancelled", () => {
	it("ends a hanging hook with Cancelled as soon as the signal fires", async () => {
		const controller = new AbortController();
		const started = Date.now();
		const op = run("hang", controller.signal);
		setTimeout(() => controller.abort(), 20);
		await expect(op).rejects.toThrow("Cancelled");
		expect(Date.now() - started).toBeLessThan(1_000);
		expect(seen.at(-1)).toBe(controller.signal);
	});

	it("a signal that is already aborted never runs the hook", async () => {
		const before = seen.length;
		await expect(run("ok", AbortSignal.abort())).rejects.toThrow("Cancelled");
		expect(seen.length).toBe(before);
	});

	it("a normal run is unchanged, and the timeout still applies", async () => {
		expect(await run("ok", new AbortController().signal)).toEqual({ success: true, error: "" });
		await expect(run("hang", new AbortController().signal, 50)).rejects.toThrow("timed out");
	});
});
