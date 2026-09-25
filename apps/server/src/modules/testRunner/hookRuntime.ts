import { z } from "zod";
import type { AssertionResult, TestHookBody } from "../../db/schema";
import { createExpect } from "./expect";
import type { SuiteHook } from "./hooks";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
	...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/** what the compiled graph calls (see `CompileOptions.hooks` in @fluxify/blocks) */
type CompiledHooks = Record<
	string,
	{
		before?: (input: unknown) => Promise<unknown>;
		after?: (input: unknown, output: unknown) => Promise<unknown>;
	}
>;

/**
 * Turns a suite's stored hooks into the functions the compiled graph calls.
 *
 * Hook scripts run as plain functions, the way the JS inside blocks does — not
 * in `JsVM`. The child holds nothing a hook could steal but the route's own
 * config.
 *
 * `t` per call: `skip(output, branch?)` (no `return` needed), `fail(message)`,
 * `call` (1, 2, 3… per block, for loops), `vars`, `block`, `runId`, `expect`,
 * `zod` (check a value's shape: `t.zod.object({ id: t.zod.number() }).parse(output)`).
 * `t.expect` lines land in `checks`, labelled with the block.
 */
export function buildHooks(
	hooks: SuiteHook[],
	env: {
		vars: Record<string, unknown>;
		runId: string;
		/** what the setup block returned (#483) */
		setup?: unknown;
		checks: AssertionResult[];
	},
): CompiledHooks {
	const compiled: CompiledHooks = {};
	for (const hook of hooks) {
		const block = { id: hook.blockId, type: hook.blockType, name: hook.blockName };
		const label = `${hook.blockType} "${hook.blockName}"`;
		const expect = createExpect((r) =>
			env.checks.push({ ...r, message: `${label}: ${r.message}` }),
		);
		let call = 0;
		const t = (skip?: (output: unknown, branch?: string) => void) => ({
			call,
			vars: env.vars,
			block,
			runId: env.runId,
			setup: env.setup,
			expect,
			zod: z,
			skip: skip ?? (() => fail("t.skip only works in onBefore")),
			fail,
		});
		const before = hook.onBefore && toFunction(hook.onBefore, ["input", "t"]);
		const after = hook.onAfter && toFunction(hook.onAfter, ["input", "output", "t"]);

		compiled[hook.blockId] = {
			before: before
				? async (input) => {
						call++;
						if (typeof before !== "function")
							return { skip: true, output: structuredClone(before.json) };
						let skipped: { output: unknown; branch?: string } | undefined;
						const result = await before(
							input,
							t((output, branch) => {
								skipped = { output, branch };
							}),
						);
						if (skipped) return { skip: true, ...skipped };
						return result === undefined ? undefined : { input: result };
					}
				: undefined,
			after: after
				? async (input, output) => {
						if (!before) call++;
						if (typeof after !== "function") return structuredClone(after.json);
						const result = await after(input, output, t());
						return result === undefined ? output : result;
					}
				: undefined,
		};
	}
	return compiled;
}

function fail(message: string): never {
	throw new Error(message);
}

/**
 * a script becomes a function; JSON is parsed once and returned as `{ json }`,
 * cloned per call so a block that mutates it cannot change the next loop pass
 */
function toFunction(body: TestHookBody, params: string[]) {
	if (body.kind === "json") return { json: JSON.parse(body.value) as unknown };
	return new AsyncFunction(...params, body.value);
}
