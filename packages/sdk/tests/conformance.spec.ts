import type { SpanRecord } from "../src/runtime/ctx.js";
import { runBlock } from "../testing.js";
import { conformance } from "./conformance.js";

/** spans by name, parent by name, error by message: what the suite compares */
const normalizeSpans = (spans: SpanRecord[]) => {
	const names = new Map(spans.map((s) => [s.id, s.name]));
	return spans.map((s) => ({
		name: s.name,
		...(s.parent ? { parent: names.get(s.parent) } : {}),
		outcome: s.outcome,
		...(s.error === undefined ? {} : { error: (s.error as Error).message }),
	}));
};

conformance("harness", async (def, opts = {}) => {
	const r = await runBlock(def, opts as any);
	return {
		handle: r.handle,
		output: r.output,
		// a throw routed to `failure` is not a failed run
		...(r.error && r.handle === undefined ? { error: r.error.message } : {}),
		spans: normalizeSpans(r.spans),
		logs: r.logs,
	};
});
