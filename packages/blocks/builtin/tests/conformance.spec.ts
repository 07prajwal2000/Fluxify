// The SDK's block contract against the real engine: register the block,
// compile a canvas around it, run it. The same suite runs against
// `@fluxify/sdk/testing` in packages/sdk, so the two cannot drift.
import { afterEach } from "bun:test";
import { type BranchStub, conformance, integrationConformance } from "@fluxify/sdk/conformance";
import { integrationRegistry } from "@fluxify/adapters";
import { runIntegrationHook } from "@fluxify/adapters/integrations";
import { type AnyIntegration, parseIntegrationKind } from "@fluxify/sdk/integrations";
import { grantContext, toStoredConfig, toVariantDef } from "@fluxify/sdk/runtime";
import { z } from "zod";
import { memoryKv, recordingLogger, type LogEntry } from "@fluxify/sdk/testing";
import { toManifestEntry } from "@fluxify/sdk/blocks";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType } from "../../builderTypes";
import { compileGraph } from "../../compiler";
import { closeCtxIntegrations, withCtxIntegrations } from "../ctxIntegrations";
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

/** the fake variants the last run registered, so the next run can register its own */
const fakeVariants: [string, string][] = [];
const dropFakeVariants = () => {
	for (const [group, variant] of fakeVariants.splice(0)) integrationRegistry.unregister(group, variant);
};

afterEach(async () => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
	dropFakeVariants();
	await closeCtxPools();
	await closeCtxIntegrations();
});

conformance("runtime", async (def, opts = {}) => {
	const entry = toManifestEntry(def);
	const ofType = (type: string) => Object.keys(entry.params).filter((k) => entry.params[k]!.type === type);
	const schemaParams = ofType("schema");
	const meta: BlockMeta = {
		handles: entry.handles as BlockMeta["handles"],
		invoke: entry.invoke,
		schemaParams,
		fieldMapParams: ofType("fieldMap"),
	};
	// what the plugin loader wraps a block in: the permissions it declared, approved
	const granted = { integrations: entry.permissions.integrations ?? [], appconfig: !!entry.permissions.appconfig };
	// fake integrations are variants of their own group in the real registry, found the way the worker finds a cached config
	dropFakeVariants();
	const fakes = opts.ctx?.integrations ?? {};
	const found = new Map<string, { group: string; variant: string; config: object }>();
	for (const [id, { kind, client }] of Object.entries(fakes)) {
		const { group, variant = "Fake" } = parseIntegrationKind(kind)!;
		if (!fakeVariants.some(([g, v]) => g === group && v === variant)) {
			integrationRegistry.register({ group, variant, label: variant, configSchema: z.object({}), create: () => client } as any);
			fakeVariants.push([group, variant]);
		}
		found.set(id, { group, variant, config: { id } });
	}
	const run: ModuleBlockRun = async (args) => {
		const open = withCtxIntegrations(args.ctx, (id) => found.get(id));
		try {
			return await def.run({ ...args, ctx: grantContext(open.ctx, granted, `block ${def.name}`) } as any);
		} finally {
			open.release();
		}
	};
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

/**
 * An `integration(...)` registered the way a worker will (I6): `toVariantDef`
 * straight into the real registry, its config resolved as the loader resolves
 * a row, its client from the worker's `ctx.integrations` pool and its ops from
 * the worker's hook runner.
 */
function registered(def: AnyIntegration, config: Record<string, unknown>) {
	const variant = toVariantDef(def);
	integrationRegistry.unregister(variant.group, variant.variant);
	integrationRegistry.register(variant);
	fakeVariants.push([variant.group, variant.variant]);
	return { variant, stored: toStoredConfig(def, config) };
}

integrationConformance("runtime", {
	async get(def, config, appConfig) {
		const { variant, stored } = registered(def, config);
		const resolved = variant.resolve!(stored, appConfig);
		const found = { group: variant.group, variant: variant.variant, config: resolved };
		const open = withCtxIntegrations({ projectId: PROJECT } as any, () => found);
		try {
			return await open.ctx.integrations.get("c");
		} finally {
			open.release();
		}
	},
	op(def, op, config, appConfig = {}, request) {
		const { variant, stored } = registered(def, config);
		const call = { group: variant.group, variant: variant.variant, config: stored, request };
		const load = (keys: string[]) =>
			new Map(keys.filter((k) => k in appConfig).map((k) => [k, appConfig[k]!]));
		return runIntegrationHook(integrationRegistry, op, call, load, 5000);
	},
	reset: () => closeCtxIntegrations(),
});
