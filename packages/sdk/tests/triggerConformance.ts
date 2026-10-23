// The plugin trigger contract (T1), run against `@fluxify/sdk/testing`
// (tests/conformance.spec.ts) and, from T3, the worker's trigger runtime. A
// runner settles each `emit` the way a workflow run ends. Workspace-only.
import { describe, expect, it } from "bun:test";
import { param } from "../blocks.js";
import { type AnyTrigger, type TriggerConnection, trigger } from "../triggers.js";

/** one `emit` the runner caught; settle it as the attached workflow's run ending */
export type CaughtEmit = {
	events: unknown[];
	connection?: TriggerConnection;
	/** the run succeeded */
	resolve(): void;
	/** the run failed with `error` (after every attempt, with `retry`) */
	reject(error: Error): void;
};

export type TriggerRunner = {
	/** starts `def` with `params`; resolves once `start` has, rejects with what it threw */
	start(
		def: AnyTrigger,
		params?: Record<string, unknown>,
	): Promise<{ nextEmit(): Promise<CaughtEmit>; stop(): Promise<void> }>;
};

const base = { label: "Conf", icon: "./conf.svg" };
const connection: TriggerConnection = {
	raw: "client",
	commit: async () => {},
	moveToDLQ: async () => {},
	lag: async () => null,
};

/** emits each batch in `batches` once, recording how each `emit` ended */
function emitting(batches: { events: unknown[]; connection?: TriggerConnection }[]) {
	const outcomes: string[] = [];
	const def = trigger({
		...base,
		name: "conf/test/emit",
		start: async (ctx) => {
			for (const b of batches)
				ctx.emit(b.events, b.connection && { connection: b.connection }).then(
					() => outcomes.push("resolved"),
					(e: Error) => outcomes.push(`rejected: ${e.message}`),
				);
		},
		stop: async () => {},
	});
	return { def, outcomes };
}

export function triggerConformance(name: string, runner: TriggerRunner) {
	describe(`${name}: triggers`, () => {
		it("start gets its params defaulted, and resolves once running", async () => {
			const seen: unknown[] = [];
			const def = trigger({
				...base,
				name: "conf/test/start",
				params: { every: param.number({ default: 5 }), topic: param.string({ required: true }) },
				start: async (ctx) => void seen.push(ctx.params),
				stop: async () => {},
			});
			await (await runner.start(def, { topic: "t" })).stop();
			expect(seen).toEqual([{ every: 5, topic: "t" }]);
		});

		it("a start that throws fails the start", async () => {
			const def = trigger({
				...base,
				name: "conf/test/throw",
				start: async () => {
					throw new Error("cannot connect");
				},
				stop: async () => {},
			});
			await expect(runner.start(def)).rejects.toThrow("cannot connect");
		});

		it("emit without a connection hands over the events, and resolves when the run succeeds", async () => {
			const { def, outcomes } = emitting([{ events: [{ n: 1 }, { n: 2 }] }]);
			const running = await runner.start(def);
			const caught = await running.nextEmit();
			expect([caught.events, caught.connection]).toEqual([[{ n: 1 }, { n: 2 }], undefined]);
			caught.resolve();
			await Bun.sleep(0);
			expect(outcomes).toEqual(["resolved"]);
			await running.stop();
		});

		it("emit with a connection hands over that very connection", async () => {
			const { def } = emitting([{ events: [1], connection }]);
			const running = await runner.start(def);
			const caught = await running.nextEmit();
			expect(caught.connection).toBe(connection);
			caught.resolve();
			await running.stop();
		});

		it("emit rejects when the run fails", async () => {
			const { def, outcomes } = emitting([{ events: [1] }]);
			const running = await runner.start(def);
			(await running.nextEmit()).reject(new Error("workflow failed"));
			await Bun.sleep(0);
			expect(outcomes).toEqual(["rejected: workflow failed"]);
			await running.stop();
		});

		it("stop aborts ctx.signal, then calls stop, which ends the poll loop", async () => {
			const order: string[] = [];
			const def = trigger({
				...base,
				name: "conf/test/stop",
				start: async (ctx) => {
					ctx.signal.addEventListener("abort", () => order.push("abort"));
				},
				stop: async () => void order.push("stop"),
			});
			const running = await runner.start(def);
			expect(order).toEqual([]);
			await running.stop();
			expect(order).toEqual(["abort", "stop"]);
		});
	});
}
