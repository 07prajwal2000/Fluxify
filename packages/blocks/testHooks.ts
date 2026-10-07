import { getOutputHandles } from "./blockHandles";
import { BlockTypes } from "./blockTypes";

/**
 * Test-suite block hooks (#483): which blocks a suite may hook, and how far.
 *
 * - `none`: the graph's frame (entry, reply, error jump, notes); nothing to test there
 * - `input`: blocks that run other chains (branches, loops, fan-out) — a hook
 *   can steer them by changing the input, but skipping would skip the chains too
 * - `full`: change the input, skip the block with a made-up output, change the output
 */
export type HookSupport = "none" | "input" | "full";

const NONE: string[] = [
	BlockTypes.entrypoint,
	BlockTypes.response,
	BlockTypes.errorHandler,
	BlockTypes.sticky_note,
];
const INPUT_ONLY: string[] = [
	BlockTypes.if,
	BlockTypes.switch,
	BlockTypes.forloop,
	BlockTypes.foreachloop,
	BlockTypes.orchestrator,
	BlockTypes.retry,
];

export function hookSupport(blockType: string): HookSupport {
	if (NONE.includes(blockType)) return "none";
	if (INPUT_ONLY.includes(blockType)) return "input";
	return "full";
}

/**
 * Where a skipped block's made-up output goes: its own outgoing branches.
 * The first is the default. Empty for a terminal block — the skip ends the chain.
 */
export function skipBranches(blockType: string): string[] {
	return getOutputHandles(blockType).filter(
		(h) => h === "source" || h === "success" || h === "failure",
	);
}

const NL = "\n";

/**
 * Compiled code that runs a block's `before` hook (see `CompileOptions.hooks`).
 * `skipTo(handle)` is the code continuing down `handle` without the `after`
 * hook: a made-up output is final, `after` only sees real ones.
 */
export function emitBeforeHook(
	type: string,
	blockId: string,
	support: HookSupport,
	skipTo: (handle: string) => string,
) {
	if (support === "none") return "";
	const branches = skipBranches(type);
	const skip =
		support === "input"
			? [
					`throw new Error(${JSON.stringify(`A ${type} block cannot be skipped; change its input instead`)});`,
				]
			: branches.length === 0
				? ["$in = $b.output;", "$mocked = { output: true };", skipTo("source")]
				: [
						"$in = $b.output;",
						"$mocked = { output: true };",
						`switch ($b.branch ?? ${JSON.stringify(branches[0])}) {`,
						...branches.flatMap((h) => [`case ${JSON.stringify(h)}: {`, skipTo(h), "}"]),
						`default: throw new Error(${JSON.stringify(`A ${type} block has no branch `)} + JSON.stringify($b.branch));`,
						"}",
					];
	return [
		`const $hook = $state.hooks?.[${blockId}];`,
		"if ($hook?.before) {",
		"const $b = await $hook.before($in);",
		"if ($b?.skip) {",
		...skip,
		"}",
		// the span records the input the block really ran with
		`if ($b && "input" in $b) { $in = $b.input; $input = $in; $mocked = { input: true }; }`,
		"}",
		// what `after` is told the block ran with
		support === "full" ? "const $hookInput = $in;" : "",
		"",
	].join(NL);
}

/**
 * compiled code letting the `after` hook replace `target`, the block's output;
 * a hook that hands back the same value has not mocked it
 */
export function emitAfterHook(support: HookSupport, target: string) {
	return support === "full"
		? `if ($hook?.after) { const $out = await $hook.after($hookInput, ${target}); if ($out !== ${target}) { ${target} = $out; $mocked = { ...$mocked, output: true }; } }${NL}`
		: "";
}
