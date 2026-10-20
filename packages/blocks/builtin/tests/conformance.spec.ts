// The SDK's block contract against the real engine: register the block,
// compile a canvas around it, run it. The same suite runs against
// `@fluxify/sdk/testing` in packages/sdk, so the two cannot drift.
import { afterEach } from "bun:test";
import { type BranchStub, conformance } from "@fluxify/sdk/conformance";
import { grantContext } from "@fluxify/sdk/runtime";
import { memoryKv, recordingLogger, type LogEntry } from "@fluxify/sdk/testing";
import { toManifestEntry } from "@fluxify/sdk/blocks";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType } from "../../builderTypes";
import { compileGraph } from "../../compiler";
import { closeCtxPools } from "../ctxPool";
import {
	type BlockMeta,
	customBlockNames,
	type ModuleBlockRun,
	registerModuleBlock,
	unregisterBlock,
} from "../customBlock";
import { collectSpans } from "./compilerTestHelpers";

const PROJECT = "proj-conformance";
const node = (id: string, type: string, data: object = {}): BlockDTOType => ({ id, type, data, position: { x: 0, y: 0 } });
const edge = (from: string, to: string, handle: string) => ({
	id: `e-${from}-${to}-${handle}`,
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-${handle}`,
});
/** which response a handle reaches, by status */
const STATUS: Record<string, string> = { source: "200", success: "201", failure: "400" };

afterEach(async () => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
	await closeCtxPools();
});

conformance("runtime", async (def, opts = {}) => {
	const entry = toManifestEntry(def);
	const schemaParams = Object.keys(entry.params).filter((k) => entry.params[k]!.type === "schema");
	const meta: BlockMeta = { handles: entry.handles as BlockMeta["handles"], invoke: entry.invoke, schemaParams };
	// what the plugin loader wraps a block in: the permissions it declared, approved
	const granted = { integrations: entry.permissions.integrations ?? [], appconfig: !!entry.permissions.appconfig };
	const run: ModuleBlockRun = (args) =>
		def.run({ ...args, ctx: grantContext(args.ctx, granted, `block ${def.name}`) } as any);
	registerModuleBlock(PROJECT, def.name, run, meta);

	// the canvas: entry -> block -> one response per output handle, stubs on the body handles
	const params = Object.fromEntries(
		Object.entries(opts.params ?? {}).map(([k, v]) => [k, schemaParams.includes(k) ? (v as any).schema : v]),
	);
	const blocks = [node("entry", BlockTypes.entrypoint), node("B", def.name, { ...params, invoke: opts.invoke })];
	const edges = [edge("entry", "B", "source")];
	for (const out of entry.handles.out) {
		blocks.push(node(out, BlockTypes.response, { httpCode: STATUS[out] }));
		edges.push(edge("B", out, out));
	}
	const metas: Record<string, BlockMeta> = { [def.name]: meta };
	for (const [h, stub] of Object.entries(opts.handles ?? {})) {
		const branches: BranchStub[] = typeof stub === "function" ? [{ label: h, run: stub }] : [...stub];
		for (const [i, b] of branches.entries()) {
			const type = `conf/stub/${h}-${i}`;
			metas[type] = { handles: { in: ["target"], out: ["source"], body: [] } };
			registerModuleBlock(PROJECT, type, async ({ input }) => ({ output: await b.run(input) }), metas[type]);
			blocks.push(node(b.id ?? b.label, type, { blockName: b.label }));
			edges.push(edge("B", b.id ?? b.label, h));
		}
	}
	const { run: graph } = compileGraph(blocks, edges, { projectId: PROJECT, blockMeta: metas });

	const logs: LogEntry[] = [];
	const { spans, trace } = collectSpans();
	const kv = opts.ctx?.kv ?? memoryKv();
	const config = opts.ctx?.config ?? {};
	const ctx = {
		route: "/conformance",
		apiId: "api-1",
		projectId: PROJECT,
		vars: { logger: recordingLogger(logs), getConfig: (k: string) => config[k] },
		stopper: { timeoutEnd: 0, duration: 10000 },
		kvFactory: { getKvAdapter: () => kv },
		trace,
	} as any;
	const result = await graph(ctx, opts.input);

	const own = spans.filter((s) => s.blockType === "span");
	const names = new Map(own.map((s) => [s.blockId, s.blockName]));
	const reply = result.output as { httpCode?: string; body?: unknown } | undefined;
	const handle = entry.handles.out.find((h) => STATUS[h] === String(reply?.httpCode));
	return {
		...(result.successful === false
			? { error: (result.error as Error)?.message ?? String(result.error) }
			: entry.handles.out.length
				? { handle, output: reply?.body }
				: { output: result.output }),
		spans: own.map((s) => ({
			name: s.blockName!,
			...(s.parent ? { parent: names.get(s.parent) } : {}),
			outcome: s.outcome,
			...(s.error === undefined ? {} : { error: (s.error as Error).message }),
		})),
		logs,
	};
});
