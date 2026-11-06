import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { TriggerLagContext } from "@fluxify/sdk/triggers";
import { lagLimits, setLagReporter, startLagSampler } from "../lagSampler";

const original = { ...lagLimits };
let reports: (number | null)[];
let controller: AbortController;

const context = (): TriggerLagContext =>
	({
		params: {},
		signal: controller.signal,
		logger: { logInfo() {}, logWarn() {}, logError() {} },
	}) as never;
const until = async (done: () => boolean) => {
	for (let i = 0; i < 200 && !done(); i++) await Bun.sleep(5);
	expect(done()).toBe(true);
};

beforeEach(() => {
	Object.assign(lagLimits, { everyMs: 10, timeoutMs: 40 });
	reports = [];
	controller = new AbortController();
	setLagReporter((_id, lag) => void reports.push(lag));
});
afterEach(() => {
	controller.abort();
	Object.assign(lagLimits, original);
	setLagReporter(() => undefined);
});

describe("the lag sampler (#963)", () => {
	it("reads on its own timer and reports each number", async () => {
		let n = 0;
		startLagSampler("t1", { read: async () => ++n * 10 }, context());
		await until(() => reports.length >= 3);
		expect(reports.slice(0, 3)).toEqual([10, 20, 30]);
	});

	it("reports unknown, never 0, for a read that throws, and goes on to the next", async () => {
		let n = 0;
		const read = async () => {
			if (++n === 1) throw new Error("source down");
			return 5;
		};
		startLagSampler("t1", { read }, context());
		await until(() => reports.length >= 2);
		expect(reports.slice(0, 2)).toEqual([null, 5]);
	});

	it("reports unknown for a read that hangs, and aborts the signal it was given", async () => {
		let seen: AbortSignal | undefined;
		const read = (ctx: TriggerLagContext) => {
			seen = ctx.signal;
			return new Promise<number>(() => {});
		};
		startLagSampler("t1", { read }, context());
		await until(() => reports.length >= 1);
		expect(reports[0]).toBeNull();
		expect(seen?.aborted).toBe(true);
		// the trigger's own signal is untouched: a slow source never stops the trigger
		expect(controller.signal.aborted).toBe(false);
	});

	it("reports unknown for anything that is not a finite number of at least 0", async () => {
		const answers = [Number.NaN, -1, Number.POSITIVE_INFINITY, "12", undefined, 0];
		let n = 0;
		startLagSampler("t1", { read: async () => answers[n++] as number }, context());
		await until(() => reports.length >= answers.length);
		expect(reports.slice(0, answers.length)).toEqual([null, null, null, null, null, 0]);
	});

	it("stops and withdraws its number when the trigger stops", async () => {
		startLagSampler("t1", { read: async () => 1 }, context());
		await until(() => reports.length >= 1);
		controller.abort();
		await until(() => reports.at(-1) === null);
		const settled = reports.length;
		await Bun.sleep(40);
		expect(reports.length).toBe(settled);
	});

	it("hands the read the instance's context with its params, not a copy of emit or fail", async () => {
		let got: Record<string, unknown> | undefined;
		const ctx = { ...context(), params: { table: "orders" } } as TriggerLagContext;
		startLagSampler(
			"t1",
			{
				read: async (c) => {
					got = c as never;
					return 1;
				},
			},
			ctx,
		);
		await until(() => got !== undefined);
		expect(got?.params).toEqual({ table: "orders" });
		expect("emit" in got!).toBe(false);
		expect("fail" in got!).toBe(false);
	});
});
