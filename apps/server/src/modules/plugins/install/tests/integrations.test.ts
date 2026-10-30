// Plugin integrations (I6) end to end: a real NATS, Postgres behind the plugin
// and integrations API, a real Valkey behind the plugin's KV variant, a real
// worker install, and the op child a real process. What a user does, in order:
// upload and approve, create an integration, Test connection, use it from a
// built-in KV block and from a plugin block, upgrade, disable, remove.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { faker } from "@faker-js/faker";
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
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
const { startWorker, until } = await import("./worker");
const { buildProjectConfig } = await import("../../../compiler/projectConfig");
const { projectConfigKey } = await import("../../../compiler/subjects");
const { serveIntegrationOps } = await import("../../../integrationOps/workerHost");
const { loadPluginIntegrations } = await import("../../../requestRouter/pluginIntegrations");
const { setPluginRefs } = await import("../../../requestRouter/pluginLoader");
const { initCompiledRuntime, shutdownCompiledRuntime } = await import(
	"../../../requestRouter/compiledRuntime"
);
const { runBlocks } = await import("../../../requestRouter/executor");
const { KvFactory } = await import("@fluxify/adapters");
// the module, not a destructured copy: hydrating reassigns the cache
const integrationsLoader = await import("../../../../loaders/integrationsLoader");
const { applyPluginVariants, syncPluginVariants } = await import("../../variants");
const integrationsApi = (await import("../../../../api/v1/integrations/register")).default;

const VALKEY_IMAGE = "valkey/valkey:8-alpine";
const VALKEY = "fluxify-plugin-integrations-valkey-test";
const NAME = "acme/store";
const PUT = `${NAME}/put`;
const ICON = "data:image/svg+xml;base64,PHN2Zy8+";
let valkeyPort = 0;

beforeAll(async () => {
	await startStack("integrations", [integrationsApi as never]);
	await docker
		.getContainer(VALKEY)
		.remove({ force: true })
		.catch(() => {});
	await pullImage(VALKEY_IMAGE);
	valkeyPort = (
		await startContainerWithRandomPort((host) =>
			docker.createContainer({
				Image: VALKEY_IMAGE,
				name: VALKEY,
				HostConfig: { PortBindings: { "6379/tcp": [{ HostPort: String(host) }] } },
			}),
		)
	).port;
	// a container that accepts TCP is not a server that answers commands
	for (let i = 0; ; i++) {
		const probe = new Bun.RedisClient(`redis://127.0.0.1:${valkeyPort}`);
		try {
			await probe.ping();
			break;
		} catch (error) {
			if (i >= 60) throw error;
			await Bun.sleep(500);
		} finally {
			probe.close();
		}
	}
}, 240_000);

afterAll(async () => {
	await shutdownCompiledRuntime();
	await stopStack();
	await docker
		.getContainer(VALKEY)
		.remove({ force: true })
		.catch(() => {});
});

type KvParams = Record<string, ReturnType<typeof param.string> | ReturnType<typeof param.number>>;
const KV_PARAMS: KvParams = {
	host: param.string({ required: true }),
	port: param.number({ required: true }),
};

/** the manifest entry the CLI writes for the KV variant */
const kvEntry = (config: KvParams) => ({
	...toIntegrationEntry({
		name: `${NAME}/kv`,
		label: "Acme KV",
		icon: ICON,
		group: "kv",
		variant: "AcmeKV",
		config,
		connect: () => ({}),
		test: () => ({ success: true }),
	} as never),
	entry: "dist/integrations/kv.js",
});

/** a variant of the plugin's own group, which only its blocks use */
const notesEntry = {
	...toIntegrationEntry({
		name: `${NAME}/notes`,
		label: "Notes",
		icon: ICON,
		group: "notes",
		variant: "Notes",
		config: {},
		connect: () => ({}),
	} as never),
	entry: "dist/integrations/notes.js",
};

/** a block writing through `ctx.integrations.get<"kv">` */
const putBlock = block({
	name: PUT,
	label: "Put",
	permissions: { integrations: ["kv", "acme/notes"] },
	params: {
		conn: param.integration({ kind: "kv" }),
		key: param.string({ required: true }),
		value: param.string({ required: true }),
	},
	async run() {
		return { output: null };
	},
});

/**
 * The built KV module: real Valkey through Bun's own client, so the plugin needs
 * no dependency. It counts its imports on `globalThis`, which is how the test
 * knows which process loaded it, and `test` answers with its pid.
 */
const KV_MODULE = `globalThis.__acmeKvImports = (globalThis.__acmeKvImports ?? 0) + 1;
export default {
	name: "${NAME}/kv", label: "Acme KV", icon: "x", group: "kv", variant: "AcmeKV",
	config: ${JSON.stringify(KV_PARAMS)},
	connect: (config) => {
		const c = new Bun.RedisClient("redis://" + config.host + ":" + config.port);
		return {
			raw: c,
			get: (k) => c.get(k),
			set: async (k, v) => void (await c.set(k, v)),
			setex: async (k, s, v) => void (await c.set(k, v, "EX", s)),
			delete: async (k) => void (await c.del(k)),
		};
	},
	test: async (client) => ({ success: (await client.raw.ping()) === "PONG", warning: String(process.pid) }),
	close: (client) => client.raw.close(),
};`;

const PUT_MODULE = `export default {
	run: async ({ params, ctx }) => {
		const kv = await ctx.integrations.get(params.conn);
		await kv.set(params.key, params.value);
		return { output: params.value };
	},
};`;

/** the plugin's files, its KV variant taking `config` */
function storeTgz(version: string, config: KvParams = KV_PARAMS) {
	return pluginTgz({
		"package.json": JSON.stringify({
			name: "@acme/store",
			version,
			fluxify: { name: NAME, url: "https://github.com/acme/fluxify-store" },
		}),
		"bun.lock": "{}",
		"fluxify.json": JSON.stringify({
			name: NAME,
			url: "https://github.com/acme/fluxify-store",
			sdk: ">=2026.10.0",
			blocks: { [PUT]: { ...toManifestEntry(putBlock), entry: "dist/blocks/put.js" } },
			integrations: [kvEntry(config), notesEntry],
		}),
		"dist/blocks/put.js": PUT_MODULE,
		"dist/integrations/kv.js": KV_MODULE,
		"dist/integrations/notes.js": `export default { name: "${NAME}/notes", label: "Notes", icon: "x", group: "notes", variant: "Notes", config: {}, connect: () => ({}) };`,
		"dist/x": null,
	} as never);
}

const ready = (status: Record<string, { state: string }>, project: string) =>
	status[pluginStatusKey(project, NAME)]?.state === "ready";

/** the project's development config as a dev worker holds it */
const devConfig = async (project: string) => buildProjectConfig(project, "development");

/** entry -> plugin block writing `key` -> built-in KV get of `key` -> response, compiled and run */
async function runKvRoute(
	project: string,
	payload: Awaited<ReturnType<typeof devConfig>>,
	integrationId: string,
	key: string,
	value: string,
) {
	const meta = blockMetaOf({ ...toManifestEntry(putBlock), entry: "dist/blocks/put.js" } as never);
	const node = (id: string, type: string, data: object = {}) => ({ id, type, data, position: { x: 0, y: 0 } });
	const edge = (from: string, to: string, handle = "source") => ({
		id: `e-${from}-${to}`,
		from,
		to,
		fromHandle: "source",
		toHandle: `${from}-${handle}`,
	});
	const compiled = compileGraph(
		[
			node("1", BlockTypes.entrypoint),
			node("2", PUT, { conn: integrationId, key, value }),
			node("3", BlockTypes.kv_operations, { connection: integrationId, operation: "get", key }),
			node("4", BlockTypes.response, { httpCode: "200" }),
		] as never,
		[edge("1", "2"), edge("2", "3"), edge("3", "4")] as never,
		{ projectId: project, blockMeta: { [PUT]: meta } },
	);
	await initCompiledRuntime([
		{
			key: projectConfigKey(project),
			value: { projectId: project, payload, compiledAt: "" },
		},
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
		{
			route: "/r1",
			projectId: project,
			apiId: "api-1",
			vars: {},
			requestBody: null,
			// what `service.ts` gives every request: a factory over the hydrated cache
			kvFactory: new KvFactory(integrationsLoader.kvIntegrationsCache),
		} as never,
	);
	if (!run?.output) throw new Error(`the route did not answer: ${String((run as any)?.error)}`);
	return run.output.body;
}

describe("a plugin's integrations, from upload to removal", () => {
	it("registers, tests in an isolated child, serves blocks, guards upgrades, and blocks removal", async () => {
		const s = await setup();
		const integrations = (path = "") => `/${s.project}/integrations${path}`;
		expect((await s.upload(storeTgz("2026.10.2001"))).status).toBe(200);

		// pending: nothing to create yet
		expect((await s.api("GET", integrations("/variants"))).body.some((g: any) => g.group === "acme/notes")).toBe(
			false,
		);
		expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
		expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);

		// the approval page reads the kinds, the secret params and the hooks
		expect((await s.get(`/${NAME}`)).body.integrations).toEqual([
			{
				group: "kv",
				variant: "AcmeKV",
				label: "Acme KV",
				ownGroup: false,
				secretParams: [],
				hooks: { test: true, describe: false, inspect: false },
			},
			{
				group: "acme/notes",
				variant: "Notes",
				label: "Notes",
				ownGroup: true,
				secretParams: [],
				hooks: { test: false, describe: false, inspect: false },
			},
		]);

		// both kinds are offered, with the plugin that provides them
		const variants = (await s.api("GET", integrations("/variants"))).body;
		expect(variants.find((g: any) => g.group === "kv").variants.at(-1)).toMatchObject({
			variant: "AcmeKV",
			builtIn: false,
			plugin: NAME,
			namespace: "acme",
		});
		expect(variants.find((g: any) => g.group === "acme/notes")).toMatchObject({ namespace: "acme" });

		// created and validated against the approved manifest, no plugin code on the admin
		expect(
			(await s.api("POST", integrations(), { name: "bad", group: "kv", variant: "AcmeKV", config: { host: "x" } }))
				.status,
		).toBe(400);
		const created = await s.api("POST", integrations(), {
			name: "cache",
			group: "kv",
			variant: "AcmeKV",
			config: { host: "127.0.0.1", port: valkeyPort },
			syncDev: true,
		});
		expect(created.status).toBe(201);
		const id = created.body.id as string;
		expect((globalThis as { __acmeKvImports?: number }).__acmeKvImports).toBeUndefined();

		const worker = await startWorker(s.project, "development");
		const ops = serveIntegrationOps(s.project, "development", () => configHeld, {
			pluginRefs: worker.installer.integrationRefs,
		});
		let configHeld = await devConfig(s.project);
		try {
			await until(worker.status, () => ready(worker.status(), s.project));
			expect(worker.installer.integrationRefs().map((r) => `${r.group}/${r.variant}`)).toEqual([
				"kv/AcmeKV",
				"acme/notes/Notes",
			]);

			// Test connection: admin -> NATS -> this worker -> a fresh child against real Valkey
			const tested = await s.api("GET", integrations(`/test-existing-connection/${id}`));
			expect(tested.status).toBe(200);
			expect(tested.body.success).toBe(true);
			expect(Number(tested.body.warning)).not.toBe(process.pid);
			// the supervisor (this process) never imported the plugin's code
			expect((globalThis as { __acmeKvImports?: number }).__acmeKvImports).toBeUndefined();

			// the execution child's side: the variants load, then a plugin block and a built-in KV block share it.
			// That child is another process than the admin; here one process plays both, so the admin's
			// metadata steps aside while the child's real definitions are registered
			const payload = await devConfig(s.project);
			applyPluginVariants(s.project, NAME, undefined);
			setPluginRefs(worker.installer.refs());
			expect(await loadPluginIntegrations(worker.installer.integrationRefs())).toEqual([]);
			const key = `pi:${faker.string.alphanumeric(8)}`;
			const value = faker.string.alphanumeric(12);
			expect(await runKvRoute(s.project, payload, id, key, value)).toBe(value);
			const probe = new Bun.RedisClient(`redis://127.0.0.1:${valkeyPort}`);
			expect(await probe.get(key)).toBe(value);
			probe.close();
			await shutdownCompiledRuntime();
			await loadPluginIntegrations([]);
			await syncPluginVariants(s.project, NAME);

			// an upgrade that drops a param the saved integration sets is refused, naming it
			expect((await s.upload(storeTgz("2026.10.2002", { host: KV_PARAMS.host! }))).status).toBe(200);
			const refused = await s.post(`/${NAME}/approve`, {});
			expect(refused.status).toBe(409);
			expect(refused.body.message).toContain('integration variant kv/AcmeKV: param port removed, but used by integration "cache"');
			const preview = (await s.get(`/${NAME}/upgrade-preview`)).body.diff;
			expect(preview.changedIntegrations).toEqual([
				{ kind: "kv/AcmeKV", change: "param port removed", breaking: true, usedBy: [{ id, name: "cache" }] },
			]);

			// one that only adds an optional param applies
			expect(
				(await s.upload(storeTgz("2026.10.2003", { ...KV_PARAMS, prefix: param.string() }))).status,
			).toBe(200);
			expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
			await until(worker.installer.integrationRefs, (refs) => refs[0]?.version.startsWith("2026.10.2003+") ?? false);
			configHeld = await devConfig(s.project);
			expect((await s.api("GET", integrations(`/test-existing-connection/${id}`))).body.success).toBe(true);

			// disabled everywhere: hidden from create, the row stays, and using it says why
			expect((await s.put(`/${NAME}/environments`, { dev: false, prod: false })).status).toBe(200);
			const hidden = (await s.api("GET", integrations("/variants"))).body;
			expect(hidden.find((g: any) => g.group === "kv").variants.some((v: any) => v.variant === "AcmeKV")).toBe(false);
			expect(
				(await s.api("POST", integrations(), { name: "more", group: "kv", variant: "AcmeKV", config: { host: "h", port: 1 } }))
					.status,
			).toBe(400);
			expect((await devConfig(s.project)).missingValues?.integrations[id]).toBe(
				`cache: plugin ${NAME} is disabled`,
			);

			// removal waits for the integration to go
			const blocked = await s.api("DELETE", `/plugins/${NAME}?projectId=${s.project}`);
			expect(blocked.status).toBe(409);
			expect(blocked.body.message).toContain('"cache" (kv/AcmeKV)');
			expect((await s.api("DELETE", integrations(`/${id}`))).status).toBe(204);
			expect((await s.api("DELETE", `/plugins/${NAME}?projectId=${s.project}`)).status).toBe(200);
		} finally {
			await ops.stop();
			await worker.stop();
		}
	}, 300_000);
});
