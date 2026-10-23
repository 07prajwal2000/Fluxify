import { describe, expect, it } from "bun:test";
import { fluxifyManifestSchema, param } from "../blocks.js";
import { runTrigger } from "../testing.js";
import { type AnyTrigger, toTriggerEntry, trigger, triggerEntryPath } from "../triggers.js";

const base = { label: "Poll", icon: "./poll.svg", start: async () => async () => {} };
const define = (def: Record<string, unknown>) => () => trigger({ ...base, ...def } as unknown as AnyTrigger);

describe("trigger()", () => {
	it("writes the manifest entry: params placed in their tabs, retry as a boolean", () => {
		const def = trigger({
			...base,
			name: "acme/t/poll",
			permissions: { integrations: ["database"] },
			tabs: ["Source", "Auth"],
			params: {
				db: param.integration({ kind: "database", tab: "Source", required: true }),
				every: param.number({ default: 5, tab: "Source" }),
				token: param.secret({ tab: "Auth" }),
			},
		});
		expect(toTriggerEntry(def)).toEqual({
			name: "acme/t/poll",
			label: "Poll",
			icon: "./poll.svg",
			permissions: { integrations: ["database"] },
			params: {
				db: { type: "integration", kind: "database", tab: "Source", required: true, order: 0 },
				every: { type: "number", default: 5, tab: "Source", order: 1 },
				token: { type: "secret", tab: "Auth", order: 0 },
			},
			tabs: ["Source", "Auth"],
			retry: false,
		});
	});

	it("refuses a missing start, and a leftover stop", () => {
		expect(define({ name: "acme/t/a", start: undefined })).toThrow("trigger acme/t/a: start() is required");
		expect(define({ name: "acme/t/a", stop: async () => {} })).toThrow(
			"trigger acme/t/a: stop() is gone: return the stop function from start()",
		);
	});

	it("fails a start that resolves without a stop function", async () => {
		const bad = trigger({ ...base, name: "acme/t/a", start: (async () => {}) as never });
		await expect(runTrigger(bad)).rejects.toThrow(
			"trigger acme/t/a: start() must resolve to its stop function",
		);
	});

	it("two runs of one definition stop independently", async () => {
		const closed: string[] = [];
		const def = trigger({
			...base,
			name: "acme/t/a",
			params: { id: param.string({ required: true }) },
			start: async (ctx) => async () => void closed.push(ctx.params.id),
		});
		const a = await runTrigger(def, { params: { id: "a" } });
		const b = await runTrigger(def, { params: { id: "b" } });
		await a.stop();
		expect([closed, a.signal.aborted, b.signal.aborted]).toEqual([["a"], true, false]);
		await b.stop();
		expect(closed).toEqual(["a", "b"]);
	});

	it("refuses a block-only field", () => {
		expect(define({ name: "acme/t/a", handles: {}, invoke: ["sync"] })).toThrow(
			"handles, invoke belong to a block, not a trigger",
		);
		expect(define({ name: "acme/t/a", run: () => {} })).toThrow("run belong to a block");
	});

	it("refuses a bad name and reserved param names", () => {
		expect(define({ name: "Acme/poll" })).toThrow("must be scope/name/.../trigger");
		// `plugin:<name>` must fit the trigger row's 255-character type
		expect(define({ name: `acme/t/${"a".repeat(241)}` })).not.toThrow();
		expect(define({ name: `acme/t/${"a".repeat(242)}` })).toThrow("<=248 characters");
		expect(define({ name: "acme/t/a", params: { any: param.string() } })).toThrow(
			"param name 'any' is reserved",
		);
		expect(define({ name: "acme/t/a", params: { __x: param.string() } })).toThrow(
			"param name '__x' is reserved (__*)",
		);
	});

	it("checks params as a block's: permissions, visibleWhen, tabs, request-only types", () => {
		expect(define({ name: "acme/t/a", params: { db: param.integration({ kind: "kv" }) } })).toThrow(
			"permissions.integrations must list 'kv'",
		);
		expect(define({ name: "acme/t/a", params: { key: param.appconfig() } })).toThrow(
			"permissions.appconfig must be true",
		);
		expect(
			define({ name: "acme/t/a", params: { a: param.string({ visibleWhen: { b: 1 } }) } }),
		).toThrow("visibleWhen names 'b'");
		expect(define({ name: "acme/t/a", tabs: ["Nope"], params: {} })).toThrow(
			"tabs lists 'Nope', which no param uses",
		);
		expect(define({ name: "acme/t/a", params: { code: param.js() } })).toThrow(
			"a trigger cannot take a js param",
		);
	});

	it("start gets its params defaulted and checked", async () => {
		const seen: unknown[] = [];
		const def = trigger({
			...base,
			name: "acme/t/a",
			params: { every: param.number({ default: 5 }), topic: param.string({ required: true }) },
			start: async (ctx) => (seen.push(ctx.params), async () => {}),
		});
		await (await runTrigger(def, { params: { topic: "t" } })).stop();
		expect(seen).toEqual([{ every: 5, topic: "t" }]);
		await expect(runTrigger(def, { params: {} as never })).rejects.toThrow(
			"param 'topic' is required",
		);
	});
});

const manifest = (triggers?: unknown[]) => ({
	name: "acme/t",
	url: "https://example.com",
	sdk: ">=2026.10.2001",
	blocks: {},
	...(triggers && { triggers }),
});
const entryOf = (name: string, extra: Record<string, unknown> = {}) => ({
	...toTriggerEntry(trigger({ ...base, name, ...extra } as AnyTrigger)),
	entry: triggerEntryPath(name),
});

describe("manifest triggers", () => {
	it("round-trips, and a manifest from before triggers still parses", () => {
		const m = manifest([entryOf("acme/t/poll", { retry: true })]);
		expect(fluxifyManifestSchema.parse(m)).toEqual(m as never);
		expect(fluxifyManifestSchema.safeParse(manifest()).success).toBe(true);
	});

	it("refuses a duplicate, one outside the plugin, a wrong entry, and another plugin's kinds", () => {
		const issues = (triggers: unknown[]) => {
			const r = fluxifyManifestSchema.safeParse(manifest(triggers));
			return r.success ? [] : r.error.issues.map((i) => i.message);
		};
		expect(issues([entryOf("acme/t/a"), entryOf("acme/t/a")])).toEqual([
			"'acme/t/a' is declared twice",
		]);
		expect(issues([entryOf("other/x/a")])).toEqual(["is not inside plugin 'acme/t'"]);
		expect(issues([{ ...entryOf("acme/t/a"), entry: "dist/a.js" }])).toEqual([
			"must be 'dist/triggers/a.js'",
		]);
		expect(issues([entryOf("acme/t/a", { permissions: { integrations: ["other/crm"] } })])[0]).toContain(
			"is not one of this plugin's own integration groups",
		);
	});
});

describe("runTrigger", () => {
	const connection = {
		raw: "client",
		commit: async () => {},
		moveToDLQ: async () => {},
		lag: async () => 3,
	};
	/** emits one batch, then commits only once the run succeeded */
	const committing = (committed: string[]) =>
		trigger({
			...base,
			name: "acme/t/a",
			retry: true,
			async start(ctx) {
				ctx.emit([{ n: 1 }], { connection }).then(
					() => committed.push("ok"),
					(e: Error) => committed.push(`failed: ${e.message}`),
				);
				return async () => {};
			},
		});

	it("records each emit with its events and connection; the test settles it", async () => {
		const committed: string[] = [];
		const run = await runTrigger(committing(committed));
		const call = await run.nextEmit();
		expect([call.events, call.connection, run.retry]).toEqual([[{ n: 1 }], connection, true]);
		expect(committed).toEqual([]);
		call.resolve();
		await Bun.sleep(0);
		expect(committed).toEqual(["ok"]);
		expect(() => call.reject()).toThrow("already settled");
		await run.stop();
	});

	it("a rejected emit rejects with the test's error", async () => {
		const committed: string[] = [];
		const run = await runTrigger(committing(committed));
		(await run.nextEmit()).reject(new Error("run failed"));
		await Bun.sleep(0);
		expect(committed).toEqual(["failed: run failed"]);
		await run.stop();
	});

	it("emit refuses a non-array and a connection missing a method", async () => {
		const errors: string[] = [];
		const def = trigger({
			...base,
			name: "acme/t/a",
			async start(ctx) {
				for (const call of [
					() => ctx.emit({ n: 1 } as never),
					() => ctx.emit([], { connection: { raw: 1, commit: async () => {} } as never }),
				])
					try {
						await call();
					} catch (e) {
						errors.push((e as Error).message);
					}
				return async () => {};
			},
		});
		await (await runTrigger(def)).stop();
		expect(errors).toEqual([
			"trigger acme/t/a: emit(events) takes an array, one item per event",
			"trigger acme/t/a: emit's connection needs moveToDLQ, lag()",
		]);
	});

	it("stop aborts the signal before the returned stop function runs", async () => {
		const order: string[] = [];
		let signal!: AbortSignal;
		const def = trigger({
			...base,
			name: "acme/t/a",
			start: async (ctx) => {
				signal = ctx.signal;
				signal.addEventListener("abort", () => order.push("abort"));
				return async () => void order.push(`stop, aborted: ${signal.aborted}`);
			},
		});
		const run = await runTrigger(def);
		expect(run.signal.aborted).toBe(false);
		await run.stop();
		expect(order).toEqual(["abort", "stop, aborted: true"]);
	});

	it("fails a stop that does not return, and a start that does not resolve", async () => {
		const hung = () => new Promise<never>(() => {});
		const run = await runTrigger(
			trigger({ ...base, name: "acme/t/a", start: async () => hung }),
			{ timeoutMs: 20 },
		);
		await expect(run.stop()).rejects.toThrow("trigger acme/t/a: stop() did not return within 20 ms");
		await expect(
			runTrigger(trigger({ ...base, name: "acme/t/a", start: hung }), { timeoutMs: 20 }),
		).rejects.toThrow("start() did not resolve within 20 ms");
	});

	it("ctx.fail stops the instance once: the signal aborts, the stop function runs, the error is kept", async () => {
		const order: string[] = [];
		let fail!: (error: unknown) => void;
		const def = trigger({
			...base,
			name: "acme/t/a",
			start: async (ctx) => {
				fail = ctx.fail;
				ctx.signal.addEventListener("abort", () => order.push("abort"));
				return async () => void order.push("stop");
			},
		});
		const run = await runTrigger(def);
		expect(run.failure).toBeUndefined();
		fail(new Error("lost the connection"));
		fail(new Error("a second one"));
		expect((await run.failed()).message).toBe("lost the connection");
		expect(run.failure?.message).toBe("lost the connection");
		await run.stop();
		expect(order).toEqual(["abort", "stop"]);
	});

	it("a ctx.fail during start stops the instance as soon as start resolves", async () => {
		const order: string[] = [];
		const def = trigger({
			...base,
			name: "acme/t/a",
			start: async (ctx) => {
				ctx.fail("not a real error");
				return async () => void order.push("stop");
			},
		});
		const run = await runTrigger(def);
		expect([order, run.signal.aborted, (await run.failed()).message]).toEqual([
			["stop"],
			true,
			"not a real error",
		]);
	});

	it("emit rejects once the instance stopped", async () => {
		let emit!: (events: unknown[]) => Promise<void>;
		const def = trigger({
			...base,
			name: "acme/t/a",
			start: async (ctx) => ((emit = ctx.emit), async () => {}),
		});
		const run = await runTrigger(def);
		await run.stop();
		await expect(emit([1])).rejects.toThrow("trigger acme/t/a is no longer running");
		expect(run.emits).toEqual([]);
	});

	it("getConfig reads the keys secret params name, or any key with permissions.appconfig", async () => {
		const read = (def: AnyTrigger, params: Record<string, unknown>) => {
			let getConfig!: (key: string) => unknown;
			const t = trigger({ ...def, start: async (ctx) => ((getConfig = ctx.getConfig), async () => {}) });
			return runTrigger(t, { params, appConfig: { TOKEN: "s", OTHER: "o" } }).then(() => getConfig);
		};
		const own = await read(
			{ ...base, name: "acme/t/a", params: { token: param.secret() } },
			{ token: "cfg:TOKEN" },
		);
		expect(own("TOKEN")).toBe("s");
		// the param's stored value works too
		expect(own("cfg:TOKEN")).toBe("s");
		expect(() => own("OTHER")).toThrow("getConfig('OTHER') is not allowed");
		const all = await read({ ...base, name: "acme/t/a", permissions: { appconfig: true } }, {});
		expect(all("OTHER")).toBe("o");
		expect(() => all("MISSING")).toThrow("app config key 'MISSING' has no value");
	});

	it("integrations.get hands out only the granted kinds", async () => {
		let get!: (id: string) => Promise<unknown>;
		const def = trigger({
			...base,
			name: "acme/t/a",
			permissions: { integrations: ["kv"] },
			start: async (ctx) => ((get = (id) => ctx.integrations.get(id)), async () => {}),
		});
		await runTrigger(def, {
			integrations: { k: { kind: "kv", client: "kv-client" }, d: { kind: "database", client: 1 } },
		});
		expect(await get("k")).toBe("kv-client");
		await expect(get("d")).rejects.toThrow("was not granted database integrations");
	});
});
