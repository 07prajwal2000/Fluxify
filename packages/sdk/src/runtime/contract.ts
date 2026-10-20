// The parts of running a programmable block that the engine and the test
// harness (`@fluxify/sdk/testing`) must agree on, written once.
import type { BlockContext } from "../context.js";
import { INVOKE_MODES } from "../reserved.js";

export type Branch = {
	id: string;
	label: string;
	/** resolves to the value the chain ended with */
	run: (input: unknown) => Promise<unknown>;
};
export type BodyHandles = Record<string, { multiple: boolean; branches: Branch[] }>;

/** What a programmable block's `run` gets to call the chains on its body handles. */
export type ExecuteHandle = {
	(handle: string, input?: unknown, opts?: { branch: string }): Promise<unknown>;
	branches(handle: string): { id: string; label: string }[];
};

/** an `allowMultiple` branch that threw, in its slot of the results (allSettled) */
export type FailedBranch = { error: unknown };

/**
 * The `executeHandle` one invocation of block `type` gets. A handle with no
 * branches is one with no edge: it resolves `undefined` (or `[]` when
 * `allowMultiple`). Once `ended()` says the outermost run is over, calls throw.
 */
export function createExecuteHandle(
	type: string,
	handles: BodyHandles,
	ended: () => boolean,
): ExecuteHandle {
	const handleOf = (name: string) => {
		const handle = Object.hasOwn(handles, name) ? handles[name] : undefined;
		if (handle) return handle;
		const known = Object.keys(handles).join(", ") || "none";
		throw new Error(`Block ${type} has no body handle '${name}'; body handles: ${known}`);
	};
	const executeHandle = async (name: string, input?: unknown, opts?: { branch: string }) => {
		if (ended()) throw new Error(`executeHandle('${name}') called after the run ended`);
		const { multiple, branches } = handleOf(name);
		if (opts?.branch !== undefined) {
			const branch =
				branches.find((b) => b.id === opts.branch) ?? branches.find((b) => b.label === opts.branch);
			if (!branch)
				throw new Error(`Block ${type} has no branch '${opts.branch}' on handle '${name}'`);
			return branch.run(input);
		}
		if (!multiple) return branches[0]?.run(input);
		const settled = await Promise.allSettled(branches.map((branch) => branch.run(input)));
		return settled.map((s): unknown =>
			s.status === "fulfilled" ? s.value : ({ error: s.reason } satisfies FailedBranch),
		);
	};
	return Object.assign(executeHandle, {
		branches: (name: string) => handleOf(name).branches.map(({ id, label }) => ({ id, label })),
	});
}

/** a block's whole result: `successful: false` carries what `run` threw */
export type RunOutcome = {
	successful: boolean;
	output?: unknown;
	handle?: string;
	error?: unknown;
};

/**
 * Where a block's result leaves by, and the value it carries. A throw goes to
 * `failure` with the error's message when the block has one and it is wired;
 * otherwise this throws, failing the run, as does an undeclared handle.
 */
export function routeResult(
	type: string,
	outs: readonly string[],
	r: RunOutcome,
	failureWired = true,
): { handle?: string; output?: unknown } {
	const branching = outs.length === 2;
	if (!r.successful) {
		const error = r.error instanceof Error ? r.error : new Error(String(r.error));
		if (branching && failureWired) return { handle: "failure", output: error.message };
		throw error;
	}
	if (r.handle !== undefined && !outs.includes(r.handle)) {
		const expected = outs.length ? outs.join(", ") : "none (terminal block)";
		throw new Error(`Block ${type} returned unknown handle '${r.handle}'; expected: ${expected}`);
	}
	if (!branching) return { handle: outs[0], output: r.output };
	return { handle: r.handle === "failure" ? "failure" : "success", output: r.output };
}

/**
 * Why a canvas may not call a block this way, or undefined when it may. The
 * caller prefixes the block (`Block 2 (acme/x/y) ...`).
 */
export function invokeError(
	mode: string,
	block: { invoke?: readonly string[]; out: readonly string[]; body: readonly string[] },
	wired: { source?: boolean; body?: readonly string[] } = {},
) {
	const allowed: readonly string[] = block.invoke ?? INVOKE_MODES;
	if (!allowed.includes(mode)) return `cannot be invoked ${mode}; allowed: ${allowed.join(", ")}`;
	// the caller never learns the outcome, so there is no branch to take
	if (mode !== "sync" && block.out.length === 2)
		return `has success/failure outputs, so it must be invoked sync, not ${mode}`;
	if (!block.out.length && wired.source) return "is terminal but has an outgoing edge";
	// only a sync call has a run to hand `executeHandle` to
	if (mode !== "sync" && wired.body?.some((h) => block.body.includes(h)))
		return `has wired body handles, so it must be invoked sync, not ${mode}`;
}

export type Granted = { integrations: readonly string[]; appconfig: boolean };

/** the ctx factories an integration kind opens, and the one call each answers */
const GATED = [
	["dbFactory", "getDbAdapter", "database"],
	["kvFactory", "getKvAdapter", "kv"],
	["queueFactory", "getProducer", "queue"],
] as const;

/**
 * A plugin block's `ctx` reaching only what was granted: integrations of the
 * granted kinds (`database`, `kv`, `queue`) and app config if granted. Anything
 * else throws, naming `label` and what it lacks.
 */
export function grantContext<C extends Pick<BlockContext, "vars" | (typeof GATED)[number][0]>>(
	ctx: C,
	granted: Granted,
	label: string,
): C {
	const deny = (what: string): never => {
		throw new Error(`${label} was not granted ${what}; approve a version that asks for it`);
	};
	const out: C = {
		...ctx,
		vars: {
			...ctx.vars,
			getConfig: granted.appconfig ? ctx.vars.getConfig : () => deny("app config"),
		},
	};
	for (const [field, method, kind] of GATED) {
		if (!ctx[field] || granted.integrations.includes(kind)) continue;
		(out as any)[field] = { [method]: () => deny(`${kind} integrations`) };
	}
	return out;
}
