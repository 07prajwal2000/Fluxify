import { z } from "zod";
import type { BlockContext } from "./context.js";
import { type BodyHandle, type Handles, type OutHandle, toHandleSpec } from "./handles.js";
import { type ManifestEntry, manifestEntrySchema } from "./manifest.js";
import type { CheckWhen, Params, ParamValues } from "./params.js";
import { INVOKE_MODES, type InvokeMode } from "./reserved.js";

export type BodyOf<H> = H extends { body: readonly (infer B)[] } ? B : never;
export type MultiName<B> =
	B extends BodyHandle<infer N> ? (B extends { allowMultiple: true } ? N : never) : never;
export type SingleName<B> =
	B extends BodyHandle<infer N> ? (B extends { allowMultiple: true } ? never : N) : never;
export type OutName<H> = H extends { out: readonly (infer O)[] }
	? O extends OutHandle<infer N>
		? N
		: never
	: "source";

/**
 * Runs the chain wired to one of the block's body handles and resolves to the
 * value it ended with. **Always await it.** It stays callable after `run`
 * returns (hand it out in a closure, like an agent's tools), but only until the
 * outermost run ends; a call after that throws.
 */
export interface ExecuteHandle<B> {
	/** an `allowMultiple` handle: every branch in parallel, one result per branch; a failed branch is `{ error }` in its slot */
	(handle: MultiName<B>, input?: unknown): Promise<unknown[]>;
	/** one branch of an `allowMultiple` handle, by id or label (see `branches`) */
	(handle: MultiName<B>, input: unknown, options: { branch: string }): Promise<unknown>;
	(handle: SingleName<B>, input?: unknown): Promise<unknown>;
	/** the branches wired to an `allowMultiple` handle, in canvas order */
	branches(handle: MultiName<B>): { id: string; label: string }[];
}

export type RunArgs<P extends Params, H> = {
	params: ParamValues<P>;
	/** the previous block's output */
	input: unknown;
	ctx: BlockContext;
	executeHandle: ExecuteHandle<BodyOf<H>>;
};

/** what `run` returns: its output, and which declared output handle to leave by (default the first) */
export type RunResult<O extends string> = [O] extends [never]
	? { output?: unknown; handle?: undefined }
	: { output?: unknown; handle?: O };

export type BlockDefinition<P extends Params, H extends Handles> = {
	/** the block type: `scope/name/folder/.../block`, lowercase; `scope/name` is the plugin */
	name: string;
	label: string;
	description?: string;
	/** a path inside the plugin, e.g. `./icon.svg` */
	icon?: string;
	/** default `square` */
	shape?: "square" | "wide";
	/** markdown for the block's Docs tab */
	docs?: string;
	/** the modes a canvas may call it in; default all three. Async and queued pass JSON only */
	invoke?: readonly InvokeMode[];
	/** what `ctx` may reach; the user approves it, and an `integration`/`appconfig` param needs it */
	permissions?: { integrations?: string[]; appconfig?: boolean };
	params?: P;
	/** default: in `target`, out `source`, no body handles */
	handles?: H;
	/** set by `deprecated(...)` */
	deprecated?: string;
	run(args: RunArgs<P, H>): RunResult<OutName<H>> | void | Promise<RunResult<OutName<H>> | void>;
};

/** each param's `visibleWhen`, checked against the block's own params */
type CheckVisible<P extends Params> = {
	[K in keyof P]: P[K] extends { visibleWhen: infer W }
		? { visibleWhen: CheckWhen<W, P> }
		: unknown;
};

const prettify = (name: unknown, error: z.ZodError) =>
	new Error(`block ${String(name)}: ${z.prettifyError(error)}`);

/** The definition minus `run`, as manifest data. */
export function toManifestEntry(def: BlockDefinition<Params, Handles>): ManifestEntry {
	const entry = {
		name: def.name,
		label: def.label,
		description: def.description,
		icon: def.icon,
		shape: def.shape ?? "square",
		docs: def.docs,
		invoke: [...(def.invoke ?? INVOKE_MODES)],
		permissions: def.permissions ?? {},
		params: def.params ?? {},
		handles: toHandleSpec(def.handles),
		deprecated: def.deprecated ?? null,
	};
	// drops `undefined`s, so the entry is exactly what `fluxify.json` will hold
	return JSON.parse(JSON.stringify(entry));
}

/** the `typeof` a present value of these param types must have */
const TYPEOF: Partial<Record<string, string>> = {
	string: "string",
	number: "number",
	boolean: "boolean",
	integration: "string",
	appconfig: "string",
};

/** why a present value does not fit its param, or undefined when it does */
function misfit(p: Params[string], value: unknown) {
	if (p.type === "select" && !p.options.includes(value as string))
		return `must be one of ${p.options.join(", ")}, got ${JSON.stringify(value)}`;
	const type = TYPEOF[p.type];
	if (type && typeof value !== type) return `must be a ${type}, got ${typeof value}`;
	if (p.type === "conditions" && !Array.isArray(value)) return "must be an array of conditions";
	if (p.type === "schema" && !(typeof value === "object" && value !== null && "zod" in value))
		return "must be a compiled schema { zod, schema } (in a test, pass both)";
}

/**
 * Fills defaults and checks params before `run`: the canvas may have left them
 * empty or wrong, and `run`'s types say they are there. An empty `schema` param
 * arrives as null; it is passed as absent, like any other. The engine and the
 * test harness both run this, so a bad param fails the same way in each.
 */
export function prepareParams(params: Params, values: Record<string, unknown> = {}) {
	const out = { ...values };
	for (const [name, p] of Object.entries(params)) {
		if (p.type === "schema" && out[name] === null) delete out[name];
		if (out[name] === undefined && "default" in p) out[name] = p.default;
		const value = out[name];
		if (value === undefined || value === null) {
			if (p.required) throw new Error(`param '${name}' is required`);
			continue;
		}
		const wrong = misfit(p, value);
		if (wrong) throw new Error(`param '${name}' ${wrong}`);
	}
	return out;
}

/**
 * Defines a programmable block. Export the result as the module's default
 * export. Throws on an invalid definition (reserved names, handle shapes,
 * invoke modes, `visibleWhen`), naming the block.
 */
export function block<
	const P extends Params = {},
	const H extends Handles = { out: readonly [OutHandle<"source">] },
>(def: BlockDefinition<P, H> & { params?: NoInfer<CheckVisible<P>> }): BlockDefinition<P, H> {
	const parsed = manifestEntrySchema.safeParse(
		toManifestEntry(def as BlockDefinition<Params, Handles>),
	);
	if (!parsed.success) throw prettify(def.name, parsed.error);
	const params = (def.params ?? {}) as Params;
	return {
		...def,
		run: (args) =>
			def.run({ ...args, params: prepareParams(params, args.params) as ParamValues<P> }),
	};
}

/**
 * Marks a param, a handle or a whole block as deprecated. `message` is shown
 * to users as written, so it says what to use instead and when the thing is
 * removed ("Ignored since Oct 2026, removed in the Jan 2027 release; use `x`.").
 */
export function deprecated<T extends object>(
	target: T,
	message: string,
): T & { deprecated: string } {
	if (!message.trim()) throw new Error("deprecated(...) needs a message");
	return { ...target, deprecated: message };
}
