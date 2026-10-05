import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { compileGraph } from "../../compiler";
import { retryBlockSchema } from "../retry";
import { block, createContext, edge } from "./compilerTestHelpers";

/** fails until the `okOn`-th try (never when 0), counting tries on the shared input */
const flaky = (okOn: number) =>
	`input.tries = (input.tries ?? 0) + 1; if (${okOn} === 0 || input.tries < ${okOn}) throw new Error("boom " + input.tries); return { ok: input.tries };`;

function retryGraph(data: Record<string, unknown>, okOn: number, wireFailure = true) {
	return compileGraph(
		[
			block("in", BlockTypes.entrypoint),
			block("retry", BlockTypes.retry, data),
			block("body", BlockTypes.jsrunner, { value: flaky(okOn) }),
			block("ok", BlockTypes.response, { httpCode: "200" }),
			block("fail", BlockTypes.response, { httpCode: "503" }),
		],
		[
			edge("in", "retry"),
			edge("retry", "body", "executor"),
			edge("retry", "ok", "success"),
			...(wireFailure ? [edge("retry", "fail", "failure")] : []),
		],
	);
}

/** runs the graph under fake timers, returning the waits it asked for */
async function runTimed(data: Record<string, unknown>, okOn: number, wireFailure = true) {
	const waits: number[] = [];
	const real = setTimeout;
	const spy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number) => {
		waits.push(ms);
		return real(fn, ms);
	}) as typeof setTimeout);
	const running = retryGraph(data, okOn, wireFailure).run(createContext(), {});
	// each retry awaits its timer; let the chain reach it, then fire it
	for (let i = 0; i < 12; i++) {
		for (let j = 0; j < 50; j++) await Promise.resolve();
		jest.advanceTimersByTime(60_000);
	}
	const result = await running;
	spy.mockRestore();
	return { result, waits };
}

describe("compiled retry block", () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it("goes to success on the first try without waiting", async () => {
		const { result, waits } = await runTimed({ maxRetries: 3 }, 1);
		expect(result.output).toEqual({ httpCode: "200", body: { ok: 1 } });
		expect(waits).toEqual([]);
	});

	it("goes to success after retries", async () => {
		const { result, waits } = await runTimed({ maxRetries: 3, delayMs: 100 }, 3);
		expect(result.output).toEqual({ httpCode: "200", body: { ok: 3 } });
		expect(waits).toEqual([100, 100]);
	});

	it("goes to failure with attempts and the last message after every try failed", async () => {
		const { result } = await runTimed({ maxRetries: 2, retryType: "none" }, 0);
		expect(result.output.httpCode).toBe("503");
		expect(result.output.body.attempts).toBe(3);
		expect(result.output.body.message).toContain("boom 3");
	});

	it("fails the route with the last error when failure is not wired", async () => {
		const { result } = await runTimed({ maxRetries: 1, retryType: "none" }, 0, false);
		expect(result.successful).toBe(false);
	});

	it.each([
		["none", [0, 0, 0, 0]],
		["fixed", [100, 100, 100, 100]],
		["linear", [100, 200, 300, 400]],
		// capped by maxDelayMs
		["exponential", [100, 200, 400, 500]],
	])("waits the right time for %s", async (retryType, expected) => {
		const { waits } = await runTimed({ maxRetries: 4, retryType, delayMs: 100, maxDelayMs: 500 }, 0);
		expect(waits).toEqual(expected);
	});

	it("waits a random time up to the exponential one for exponential_jitter", async () => {
		const random = spyOn(Math, "random").mockReturnValue(0.5);
		const { waits } = await runTimed(
			{ maxRetries: 4, retryType: "exponential_jitter", delayMs: 100, maxDelayMs: 500 },
			0,
		);
		random.mockRestore();
		expect(waits).toEqual([50, 100, 200, 250]);
	});

	it("does not retry a response sent inside the executor chain", async () => {
		const { run } = compileGraph(
			[
				block("in", BlockTypes.entrypoint),
				block("retry", BlockTypes.retry, { maxRetries: 3 }),
				block("early", BlockTypes.response, { httpCode: "202" }),
				block("ok", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("in", "retry"), edge("retry", "early", "executor"), edge("retry", "ok", "success")],
		);
		const result = await run(createContext(), {});
		expect(result.output.httpCode).toBe("202");
	});
});

describe("retry block settings", () => {
	it.each([0, -1, 11, 2.5])("rejects max retries %p", (maxRetries) => {
		expect(retryBlockSchema.safeParse({ maxRetries }).success).toBe(false);
	});

	it("rejects an unknown retry type and a wait above 30s", () => {
		expect(retryBlockSchema.safeParse({ retryType: "random" }).success).toBe(false);
		expect(retryBlockSchema.safeParse({ delayMs: 30_001 }).success).toBe(false);
	});

	it("fills the defaults, including from cleared text fields", () => {
		expect(retryBlockSchema.parse({ maxRetries: "", delayMs: "" })).toMatchObject({
			maxRetries: 3,
			retryType: "fixed",
			delayMs: 1000,
			maxDelayMs: 30_000,
		});
	});
});
