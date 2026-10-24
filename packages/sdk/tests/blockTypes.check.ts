// Type tests: compiled by `bun run typecheck`, never run. An `@ts-expect-error`
// with no error under it fails the typecheck, so each one proves a rejection.
import type { ZodType } from "zod";
import { block, deprecated, handle, type IntegrationId, param } from "../blocks.js";
import type { DatabaseAdapter, KvAdapter } from "../integrations.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assert = <T extends true>() => {};

// the example from the issue: every param kind, all three handle kinds
block({
	name: "acme/slack/messages/post",
	label: "Post message",
	invoke: ["sync"],
	permissions: { integrations: ["kv"], appconfig: true },
	params: {
		mode: param.select({ options: ["simple", "advanced"] }),
		channel: param.string({ required: true }),
		count: param.number({ default: 3 }),
		conn: param.integration({ kind: "kv" }),
		key: param.appconfig(),
		shape: param.schema({ visibleWhen: { mode: "advanced" } }),
		where: param.conditions(),
		legacy: deprecated(param.string(), "Ignored since Oct 2026, removed in the Jan 2027 release; use `channel`."),
	},
	handles: {
		in: [handle.in("target")],
		out: [handle.out("success"), handle.out("failure")],
		body: [handle.body("tools", "bottom-left", { allowMultiple: true }), handle.body("each", "top-left")],
	},
	async run({ params, executeHandle }) {
		assert<
			Equal<
				typeof params,
				{
					channel: string;
					count: number;
					mode?: "simple" | "advanced";
					conn?: IntegrationId<"kv">;
					key?: string;
					shape?: { zod: ZodType; schema: unknown };
					where?: import("../blocks.js").Condition[];
					legacy?: string;
				}
			>
		>();
		const all = await executeHandle("tools", { q: 1 });
		assert<Equal<typeof all, unknown[]>>();
		const one = await executeHandle("tools", {}, { branch: "search" });
		assert<Equal<typeof one, unknown>>();
		await executeHandle("each", 1);
		// @ts-expect-error `{ branch }` is only for allowMultiple handles
		await executeHandle("each", 1, { branch: "x" });
		// @ts-expect-error not a body handle
		await executeHandle("success");
		executeHandle.branches("tools");
		return { output: 1, handle: "failure" };
	},
});

// visibleWhen keys and values are checked against the block's own params
const visible = { mode: param.select({ options: ["a", "b"] }), flag: param.boolean(), json: param.json() };
const run = () => ({ output: 1 });
block({
	name: "acme/x/a",
	label: "A",
	params: {
		...visible,
		x: param.string({ visibleWhen: { all: [{ mode: ["a", "b"] }, { any: [{ flag: true }] }] } }),
	},
	run,
});
// @ts-expect-error not one of mode's options
block({ name: "acme/x/a", label: "A", params: { ...visible, x: param.string({ visibleWhen: { mode: "c" } }) }, run });
// @ts-expect-error no param called `mood`
block({ name: "acme/x/a", label: "A", params: { ...visible, x: param.string({ visibleWhen: { mood: "a" } }) }, run });
// @ts-expect-error a boolean compared to a string
block({ name: "acme/x/a", label: "A", params: { ...visible, x: param.string({ visibleWhen: { flag: "yes" } }) }, run });
// @ts-expect-error a json param cannot be compared
block({ name: "acme/x/a", label: "A", params: { ...visible, x: param.string({ visibleWhen: { json: "a" } }) }, run });

// the returned handle must be a declared output
block({
	name: "acme/x/h",
	label: "H",
	handles: { out: [handle.out("success"), handle.out("failure")] },
	// @ts-expect-error not a declared output
	run: () => ({ handle: "source" }),
});

// select default must be an option
// @ts-expect-error
param.select({ options: ["a", "b"], default: "c" });
// js and schema params take no default
// @ts-expect-error
param.js({ default: "1" });
// a number param's bounds are numbers, and integer is a boolean
param.number({ min: 0, max: 10, integer: true });
// @ts-expect-error
param.number({ min: "0" });
// @ts-expect-error
param.number({ integer: "yes" });

// out shapes: terminal, source (default), success/failure only
block({ name: "acme/x/t", label: "T", handles: { out: [] }, run: () => ({ output: 1 }) });
block({
	name: "acme/x/t2",
	label: "T",
	handles: { out: [] },
	// @ts-expect-error a terminal block leaves by no handle
	run: () => ({ handle: "source" }),
});
block({ name: "acme/x/s", label: "S", run: () => ({ handle: "source" }) });
block({
	name: "acme/x/s2",
	label: "S",
	// @ts-expect-error `failure` is not declared
	run: () => ({ handle: "failure" }),
});
block({
	name: "acme/x/o",
	label: "O",
	// @ts-expect-error not an allowed output shape
	handles: { out: [handle.out("failure")] },
	run: () => {},
});
block({
	name: "acme/x/o2",
	label: "O",
	// @ts-expect-error not an allowed output shape
	handles: { out: [handle.out("source"), handle.out("failure")] },
	run: () => {},
});

// no body handles: executeHandle takes nothing
block({
	name: "acme/x/n",
	label: "N",
	async run({ executeHandle, ctx }) {
		// @ts-expect-error no body handles
		await executeHandle("tools");
		// span and pool are always there on a module block's ctx
		await ctx.span("x", () => 1);
		await ctx.pool("k", "key", { create: () => 1 });
	},
});

// ctx.integrations.get: a built-in group literal gives that group's adapter, any other type passes through
block({
	name: "acme/slack/integrations",
	label: "Integrations",
	permissions: { integrations: ["database", "kv", "acme/store"] },
	params: { conn: param.integration({ kind: "database" }) },
	async run({ params, ctx }) {
		type AcmeClient = { send(text: string): Promise<void> };
		const db = await ctx.integrations.get<"database">(params.conn);
		assert<Equal<typeof db, DatabaseAdapter>>();
		const kv = await ctx.integrations.get<"kv">("id");
		assert<Equal<typeof kv, KvAdapter>>();
		const acme = await ctx.integrations.get<AcmeClient>("id");
		assert<Equal<typeof acme, AcmeClient>>();
		const loose = await ctx.integrations.get("id");
		assert<Equal<typeof loose, unknown>>();
		return { output: acme };
	},
});
