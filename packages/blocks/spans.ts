import { blockName } from "./baseBlock";
import type { BlockDTOType } from "./builderTypes";

/**
 * The span recording code for one compiled block. With `tracing` off (#576)
 * every piece emits nothing: no timer, no try/catch, no `$trace` checks, since
 * nothing would ever read the spans.
 *
 * `entry` marks the graph's own entrypoint (not a custom block's): its span
 * records `ctx.traceInput`, the whole request or trigger (#628).
 */
export function blockSpans(block: BlockDTOType, tracing: boolean, mockable = false, entry = false) {
	const name = blockName(block.data);
	// the canvas position, so the viewer can still draw a block deleted since (#628)
	const position = block.position
		? `, position: ${JSON.stringify({ x: block.position.x, y: block.position.y })}`
		: "";
	const fields = `blockId: ${JSON.stringify(block.id)}, blockType: ${JSON.stringify(block.type)}${name ? `, blockName: ${JSON.stringify(name)}` : ""}${position}`;
	const input = entry ? "ctx.traceInput ?? $input" : "$input";

	/** `next`: the block a Switch handed off to, which its shared case handle cannot tell */
	function record(output: string, error?: string, branch?: "success" | "failure", next?: string) {
		if (!tracing) return "";
		const outcome = error === undefined ? "success" : "failure";
		const branchField = branch ? `, branch: ${JSON.stringify(branch)}` : "";
		const nextField = next ? `, next: ${JSON.stringify(next)}` : "";
		const errorField = error === undefined ? "" : `, error: ${error}`;
		const span = `{ ${fields}, input: ${input}, output: ${output}, startedAt: $t0, endedAt: performance.now(), outcome: ${JSON.stringify(outcome)}${branchField}${nextField}${errorField}${mockable ? ", mocked: $mocked" : ""} }`;
		return `$recorded = true;
if ($trace) {
try {
$trace.recordSpan(${span});
} catch {
// Telemetry must never change route execution.
}
}`;
	}

	/** the block function's body around the emitted block code */
	function wrap(code: string) {
		// what a test hook faked (#627); see emitBeforeHook
		const mocked = mockable ? "let $mocked;\n" : "";
		if (!tracing) {
			return `const { ctx, vars, scope: $scope } = $state;
let $in = $input;
${mocked}${code}`;
		}
		return `const { ctx, vars, scope: $scope, trace: $trace } = $state;
const $t0 = $trace ? performance.now() : 0;
let $in = $input;
${mocked}let $recorded = false;
try {
${code}
} catch ($error) {
if (!$recorded) {
${record("undefined", "$error")}
}
throw $error;
}`;
	}

	return {
		record,
		wrap,
		/**
		 * Marks the block reported before handing off to blocks it runs, so their
		 * throw is not misattributed to it. Empty when `$recorded` does not exist.
		 */
		handOff: tracing ? "$recorded = true" : "",
	};
}
