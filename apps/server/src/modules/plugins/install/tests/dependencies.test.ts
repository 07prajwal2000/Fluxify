// Plugin dependencies (#899) end to end: a real NATS and Postgres behind the
// plugin and integrations API, a real worker install, the npm registry mocked.
// What a user does, in order: preview the install of a plugin that depends on
// another, install both, approve them (the dependent only after its
// dependency), create an integration of the dependency's group, run the
// dependent's block against it, then switch the dependency off.
import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { BlockTypes, compileGraph } from "@fluxify/blocks";
import { block, param, toManifestEntry } from "@fluxify/sdk/blocks";
import { toIntegrationEntry } from "@fluxify/sdk/integrations";

// the admin's change broadcast is Redis pub/sub, which nothing here listens to
const redis = { ...(await import("../../../../db/redis")) };
mock.module("../../../../db/redis", () => ({ ...redis, publishMessage: async () => {} }));

const { pluginStatusKey } = await import("@fluxify/common/orchestrator");
const { setup, startStack, stopStack } = await import("../../sources/tests/stack");
const { pluginTgz } = await import("../../sources/tests/tarball");
const { blockMetaOf } = await import("../../meta");
const { loadPluginSets } = await import("../../compile");
const { startWorker, until } = await import("./worker");
const { buildProjectConfig } = await import("../../../compiler/projectConfig");
const { projectConfigKey } = await import("../../../compiler/subjects");
const { loadPluginIntegrations } = await import("../../../requestRouter/pluginIntegrations");
const { setPluginRefs } = await import("../../../requestRouter/pluginLoader");
const { initCompiledRuntime, shutdownCompiledRuntime } = await import(
	"../../../requestRouter/compiledRuntime"
);
const { runBlocks } = await import("../../../requestRouter/executor");
const { applyPluginVariants, syncPluginVariants } = await import("../../variants");
const integrationsApi = (await import("../../../../api/v1/integrations/register")).default;

const CRM = "other/crm";
const SALES = "acme/sales";
const FIND = `${SALES}/find`;
const ICON = "data:image/svg+xml;base64,PHN2Zy8+";
const URL_ = "https://github.com/acme/fluxify-plugins";

beforeAll(async () => {
	await startStack("dependencies", [integrationsApi as never]);
}, 240_000);
afterAll(async () => {
	await shutdownCompiledRuntime();
	await stopStack();
});

/** the dependency: group other/crm, variant Hub, whose client finds a record */
const hubEntry = {
	...toIntegrationEntry({
		name: `${CRM}/hub`,
		label: "Hub",
		icon: ICON,
		group: "crm",
		variant: "Hub",
		config: { region: param.string({ required: true }) },
		connect: () => ({}),
	} as never),
	group: CRM,
	entry: "dist/integrations/hub.js",
};
const HUB_MODULE = `export default {
	name: "${CRM}/hub", label: "Hub", icon: "x", group: "crm", variant: "Hub",
	config: { region: { type: "string", required: true } },
	connect: (config) => ({ find: async (id) => ({ id, region: config.region, from: "hub" }) }),
};`;

/** the dependent: one block using the dependency's group */
const findBlock = block({
	name: FIND,
	label: "Find",
	permissions: { integrations: [CRM] },
	params: { crm: param.integration({ kind: CRM, variants: ["Hub"] }), id: param.string() },
	async run() {
		return { output: null };
	},
});
const FIND_MODULE = `export default {
	run: async ({ params, ctx }) => ({ output: await (await ctx.integrations.get(params.crm)).find(params.id) }),
};`;

const pkg = (name: string, plugin: string, version: string, peers: Record<string, string> = {}) =>
	JSON.stringify({ name, version, fluxify: { name: plugin, url: URL_ }, peerDependencies: peers });

const crmTgz = (version: string) =>
	pluginTgz({
		"package.json": pkg("@other/crm", CRM, version),
		"fluxify.json": JSON.stringify(crmManifest()),
		"dist/blocks/step.js": null,
		"dist/integrations/hub.js": HUB_MODULE,
	});
const crmManifest = () => ({ name: CRM, url: URL_, sdk: ">=2026.10.0", blocks: {}, integrations: [hubEntry] });

const salesManifest = () => ({
	name: SALES,
	url: URL_,
	sdk: ">=2026.10.0",
	blocks: { [FIND]: { ...toManifestEntry(findBlock), entry: "dist/blocks/find.js" } },
	dependencies: [{ name: "@other/crm", plugin: CRM, range: "^1.0.0" }],
});
const salesTgz = () =>
	pluginTgz({
		"package.json": pkg("@acme/sales", SALES, "1.0.0", { "@other/crm": "^1.0.0" }),
		"fluxify.json": JSON.stringify(salesManifest()),
		"dist/blocks/step.js": null,
		"dist/blocks/find.js": FIND_MODULE,
	});

/** the web as the admin and the worker see it: jsDelivr, the registry and its tarballs */
const web = new Map<string, () => Response>();
const sri = (bytes: Uint8Array) => `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function publish(name: string, versions: Record<string, { tgz: Uint8Array; manifest: object }>) {
	const tarball = (v: string) => `https://registry.npmjs.org/${name}/-/x-${v}.tgz`;
	web.set(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, () =>
		Response.json({
			time: Object.fromEntries(Object.keys(versions).map((v) => [v, daysAgo(30)])),
			versions: Object.fromEntries(
				Object.entries(versions).map(([v, { tgz }]) => [v, { dist: { tarball: tarball(v), integrity: sri(tgz) } }]),
			),
		}),
	);
	for (const [v, { tgz, manifest }] of Object.entries(versions)) {
		web.set(`https://cdn.jsdelivr.net/npm/${name}@${v}/fluxify.json`, () => Response.json(manifest));
		web.set(tarball(v), () => new Response(tgz as BodyInit));
	}
}

const original = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = original;
});
const serveWeb = () =>
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		const page = web.get(url);
		// anything else (NATS is not HTTP; the stack's own calls go through app.request) stays real
		return page ? page() : original(input as never, init);
	}) as typeof fetch);

type Payload = Awaited<ReturnType<typeof buildProjectConfig>>;

/** entry -> the dependent's block finding `id` through integration `crm` -> response, compiled and run */
async function runFind(project: string, payload: Payload, crm: string, id: string) {
	const meta = blockMetaOf({ ...toManifestEntry(findBlock), entry: "dist/blocks/find.js" } as never);
	const node = (nodeId: string, type: string, data: object = {}) => ({ id: nodeId, type, data, position: { x: 0, y: 0 } });
	const edge = (from: string, to: string) => ({ id: `e-${from}-${to}`, from, to, fromHandle: "source", toHandle: `${from}-source` });
	const compiled = compileGraph(
		[node("1", BlockTypes.entrypoint), node("2", FIND, { crm, id }), node("3", BlockTypes.response, { httpCode: "200" })] as never,
		[edge("1", "2"), edge("2", "3")] as never,
		{ projectId: project, blockMeta: { [FIND]: meta } },
	);
	await initCompiledRuntime([
		{ key: projectConfigKey(project), value: { projectId: project, payload, compiledAt: "" } },
		{
			key: `route.${project}.r1`,
			value: {
				routeId: "r1",
				projectId: project,
				projectName: "p",
				method: "GET",
				path: "/r1",
				timeoutSeconds: 30,
				acceptedContentTypes: [],
				tracingEnabled: false,
				recordExecution: false,
				routeVersion: "",
				compiledAt: "",
				source: compiled.source,
				pluginBlocks: compiled.pluginBlocks,
			},
		},
	]);
	const run = await runBlocks(
		{ projectId: project, routeId: "r1", projectName: "p" },
		{ route: "/r1", projectId: project, apiId: "api-1", vars: {}, requestBody: null } as never,
	);
	if (!run?.output) throw new Error(`the route did not answer: ${String((run as any)?.error)}`);
	return run.output.body;
}

describe("a plugin that depends on another plugin", () => {
	it("installs its dependency with it, approves in order, and runs against the dependency's group", async () => {
		serveWeb();
		publish("@other/crm", {
			"1.0.0": { tgz: crmTgz("1.0.0"), manifest: crmManifest() },
			"1.2.0": { tgz: crmTgz("1.2.0"), manifest: crmManifest() },
			"2.0.0": { tgz: crmTgz("2.0.0"), manifest: crmManifest() },
		});
		publish("@acme/sales", { "1.0.0": { tgz: salesTgz(), manifest: salesManifest() } });
		const s = await setup();

		// the dialog's preview: the dependency, at the newest version in range, nothing installed yet
		const preview = await s.post("/npm/resolve", { spec: "@acme/sales@1.0.0" });
		expect(preview.status).toBe(200);
		expect(preview.body).toEqual({
			name: "@acme/sales",
			plugin: SALES,
			version: "1.0.0",
			dependencies: [{ name: "@other/crm", plugin: CRM, version: "1.2.0" }],
		});
		expect(await s.rows()).toHaveLength(0);

		// confirmed: both arrive, pending
		expect((await s.post("/npm", { spec: "@acme/sales@1.0.0" })).status).toBe(200);
		const rows = (await s.rows()) as unknown as { name: string; version: string; approval: string }[];
		expect(rows.map((r) => [r.name, r.version, r.approval]).sort()).toEqual([
			[SALES, "1.0.0", "pending"],
			[CRM, "1.2.0", "pending"],
		]);

		// the dependent waits for its dependency
		const early = await s.post(`/${SALES}/approve`, {});
		expect(early.status).toBe(409);
		expect(early.body.message).toContain(`it needs plugin ${CRM} ^1.0.0, which is waiting for approval`);
		expect((await s.post(`/${CRM}/approve`, {})).status).toBe(200);
		expect((await s.post(`/${SALES}/approve`, {})).status).toBe(200);
		for (const name of [CRM, SALES])
			expect((await s.put(`/${name}/environments`, { dev: true, prod: false })).status).toBe(200);

		// the plugin page: Depends on and Used by
		expect((await s.get(`/${SALES}`)).body.dependencies.dependsOn).toEqual([
			{ plugin: CRM, package: "@other/crm", range: "^1.0.0", installed: { version: "1.2.0", approval: "approved" }, satisfied: true },
		]);
		expect((await s.get(`/${CRM}`)).body.dependencies.usedBy).toEqual([
			{ plugin: SALES, version: "1.0.0", range: "^1.0.0", approval: "approved" },
		]);

		// an integration of the dependency's group, which the dependent's block picks
		const created = await s.api("POST", `/${s.project}/integrations`, {
			name: "crm",
			group: CRM,
			variant: "Hub",
			config: { region: "eu" },
			syncDev: true,
		});
		expect(created.status).toBe(201);
		const id = created.body.id as string;

		const worker = await startWorker(s.project, "development");
		const ready = (name: string) => worker.status()[pluginStatusKey(s.project, name)]?.state === "ready";
		try {
			await until(worker.status, () => ready(CRM) && ready(SALES));
			// the execution child's side, in this process: the real variant replaces the admin's metadata
			const payload = await buildProjectConfig(s.project, "development");
			applyPluginVariants(s.project, CRM, undefined);
			setPluginRefs(worker.installer.refs());
			expect(await loadPluginIntegrations(worker.installer.integrationRefs())).toEqual([]);
			expect(await runFind(s.project, payload, id, "7")).toEqual({ id: "7", region: "eu", from: "hub" });
			await shutdownCompiledRuntime();
			await loadPluginIntegrations([]);
			await syncPluginVariants(s.project, CRM);

			// the dependency switched off: the dependent stops with it, saying why
			expect((await s.put(`/${CRM}/environments`, { dev: false, prod: false })).status).toBe(200);
			expect((await loadPluginSets(s.project)).development.unusable.get(FIND)).toBe(
				`plugin ${SALES}@1.0.0 cannot load: it needs plugin ${CRM} ^1.0.0: plugin ${CRM}@1.2.0 is not enabled in development`,
			);
			expect((await s.get(`/${SALES}`)).body.blocked.development).toContain("is not enabled in development");
			await until(worker.installer.refs, (refs) => refs.length === 0);
			expect(worker.installer.refs()).toEqual([]);
		} finally {
			await worker.stop();
		}
	}, 300_000);

	it("refuses a cycle and a conflict before installing anything", async () => {
		serveWeb();
		const s = await setup();
		// a/x depends on b/x, which depends on a/x
		const cyclic = (self: string, other: string) => ({
			name: self,
			url: URL_,
			sdk: ">=2026.10.0",
			blocks: {},
			dependencies: [{ name: `@${other}`, plugin: other, range: "^1.0.0" }],
		});
		publish("@a/x", { "1.0.0": { tgz: crmTgz("1.0.0"), manifest: cyclic("a/x", "b/x") } });
		publish("@b/x", { "1.0.0": { tgz: crmTgz("1.0.0"), manifest: cyclic("b/x", "a/x") } });
		const cycle = await s.post("/npm/resolve", { spec: "@a/x@1.0.0" });
		expect(cycle.status).toBe(409);
		expect(cycle.body.message).toBe("Plugin dependencies form a cycle: a/x -> b/x -> a/x");
		expect(await s.rows()).toHaveLength(0);
	});
});
