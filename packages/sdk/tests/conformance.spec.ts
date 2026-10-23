import { block, param } from "../blocks.js";
import { integrationGroup } from "../integrations.js";
import type { SpanRecord } from "../src/runtime/ctx.js";
import { runBlock, runIntegration, runTrigger, testPool } from "../testing.js";
import { conformance, integrationConformance, triggerConformance } from "./conformance.js";

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

// the harness's `ctx.integrations` fake, given the real definition, and `runIntegration`
let pool = testPool();
integrationConformance("harness", {
	async get(def, config, appConfig) {
		const kind = integrationGroup(def);
		const reach = block({
			name: "conf/test/reach",
			label: "Reach",
			permissions: { integrations: [kind] },
			params: { conn: param.integration({ kind }) },
			run: async ({ params, ctx }) => ({ output: await ctx.integrations.get(params.conn) }),
		});
		const r = await runBlock(reach, {
			params: { conn: "c" },
			ctx: { pool, integrations: { c: { integration: def, config, appConfig } } },
		});
		if (r.error) throw r.error;
		return r.output;
	},
	op: (def, op, config, appConfig, request) =>
		runIntegration(def, { config, appConfig })[op](request) as Promise<any>,
	async reset() {
		await pool.close();
		pool = testPool();
	},
});

triggerConformance("harness", {
	async start(def, params) {
		const run = await runTrigger(def, { params: params as never });
		return { nextEmit: () => run.nextEmit(), stop: () => run.stop() };
	},
});
