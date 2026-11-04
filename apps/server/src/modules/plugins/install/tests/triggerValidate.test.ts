// A plugin trigger's `validate` (#985) end to end: a real Postgres and NATS
// behind the triggers API, a real worker install, and the real execution
// process answering on the development bus. The trigger's `validate` asks the
// database whether its table exists, so a save is refused, then accepted once
// the table is there, and saved with a warning while no development worker runs.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { faker } from "@faker-js/faker";
import { param } from "@fluxify/sdk/blocks";
import { toTriggerEntry, trigger } from "@fluxify/sdk/triggers";

// the admin seals the request and the worker opens it: CI sets a key, a local run may not
process.env.MASTER_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

// the admin's change broadcast is Redis pub/sub, which nothing here listens to
const redis = { ...(await import("../../../../db/redis")) };
mock.module("../../../../db/redis", () => ({ ...redis, publishMessage: async () => {} }));

const { pluginStatusKey } = await import("@fluxify/common/orchestrator");
const { setup, startStack, stopStack } = await import("../../sources/tests/stack");
const { pluginTgz } = await import("../../sources/tests/tarball");
const { startWorker, until } = await import("./worker");
const { projectConfigKey } = await import("../../../compiler/subjects");
const { createExecutionSupervisor } = await import("../../../requestRouter/executionSupervisor");
const { serveTriggerValidation } = await import("../../../triggers/validateHost");
const { NO_DEV_WORKER_WARNING } = await import("../../../triggers/validateDispatch");
const triggersApi = (await import("../../../../api/v1/triggers/register")).default;
const { ensureStreamOnce } = await import("@fluxify/common/nats");
const { natsConnection, natsStreamSpec } = await import("../../../../db/nats");
const { TRIGGERS_STREAM_SPEC } = await import("../../../triggers/subjects");

const NAME = "acme/pgcheck";
const KIND = `${NAME}/poller`;
let sql: Awaited<ReturnType<typeof startStack>>["sql"];
let url: string;

beforeAll(async () => {
	({ sql, url } = await startStack("trigger-validate", [triggersApi as never]));
}, 240_000);
afterAll(stopStack);

const params = {
	table: param.string({ required: true }),
	dsn: param.secret({ required: true }),
};
/** the manifest side; its code is `CHECKED` */
const definition = trigger({
	name: KIND,
	label: "Poller",
	icon: "data:image/svg+xml;base64,PHN2Zy8+",
	params,
	start: async () => async () => {},
	validate: async () => {},
});

const CHECKED = `import { SQL } from "bun";
import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";

export default trigger({
	name: "${KIND}",
	label: "Poller",
	icon: "./poller.svg",
	params: { table: param.string({ required: true }), dsn: param.secret({ required: true }) },
	start: async () => async () => {},
	async validate(ctx) {
		const sql = new SQL(String(ctx.getConfig(ctx.params.dsn)), { max: 1 });
		try {
			const [found] = await sql\`SELECT to_regclass(\${ctx.params.table}) AS t\`;
			if (!found.t) throw new Error(\`table \${ctx.params.table} does not exist\`);
			const [{ n }] = await sql.unsafe(\`SELECT count(*)::int AS n FROM \${ctx.params.table}\`);
			return n === 0 ? [\`table \${ctx.params.table} is empty\`] : [];
		} finally {
			await sql.close();
		}
	},
});
`;

const tgz = pluginTgz({
	"package.json": JSON.stringify({
		name: "@acme/pgcheck",
		version: "2026.11.0401",
		fluxify: { name: NAME, url: "https://github.com/acme/fluxify-pgcheck" },
	}),
	"bun.lock": "{}",
	"fluxify.json": JSON.stringify({
		name: NAME,
		url: "https://github.com/acme/fluxify-pgcheck",
		sdk: ">=2026.10.0",
		blocks: {},
		triggers: [{ ...toTriggerEntry(definition), entry: "dist/triggers/poller.js" }],
	}),
	"dist/triggers/poller.js": CHECKED,
	"dist/blocks/step.js": null,
} as never);

describe("plugin triggers: validate", () => {
	it("refuses a save the trigger's validate rejects, accepts it once fixed, and warns with no worker", async () => {
		const s = await setup();
		// a real stack has the triggers stream: a validate subject under it gets a stream ack, not an answer
		for (const env of ["development", "production"] as const)
			await ensureStreamOnce(natsConnection(), natsStreamSpec(TRIGGERS_STREAM_SPEC, env));
		expect((await s.upload(tgz)).status).toBe(200);
		expect((await s.post(`/${NAME}/approve`, {})).status).toBe(200);
		expect((await s.put(`/${NAME}/environments`, { dev: true, prod: false })).status).toBe(200);
		const table = `jobs_${faker.string.alpha({ length: 8, casing: "lower" })}`;
		const create = () =>
			s.api("POST", "/triggers", {
				name: `t-${faker.string.alphanumeric(8)}`,
				type: `plugin:${KIND}`,
				projectId: s.project,
				active: true,
				source: { table, dsn: "cfg:PG_URL" },
			});

		// nothing can run the plugin's code yet: saved, and the user is told
		const unchecked = await create();
		expect(unchecked.status).toBe(200);
		expect(unchecked.body.warnings).toEqual([NO_DEV_WORKER_WARNING]);

		const worker = await startWorker(s.project, "development");
		const port = 20_000 + Math.floor(Math.random() * 12_000);
		const supervisor = createExecutionSupervisor({
			projectId: s.project,
			port,
			entry: new URL("../../../requestRouter/executionProcess.ts", import.meta.url),
			databaseIdleTimeoutMs: 5_000,
			asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 2_000 },
			maxRequestBodyBytes: 1_024,
			scheduleHorizonMs: 1_000,
			logging: { level: "warn", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
			artifacts: () => [
				{
					key: projectConfigKey(s.project),
					value: {
						projectId: s.project,
						compiledAt: new Date().toISOString(),
						payload: {
							appConfig: { PG_URL: url },
							dbIntegrations: {},
							kvIntegrations: {},
							observabilityIntegrations: {},
							aiIntegrations: {},
							projectSettings: {},
						},
					},
				},
			],
			trustedOrigins: [],
			baseDomain: () => "",
			env: "development",
			timeoutsEnabled: () => false,
			pluginRefs: () => [],
			pluginTriggerRefs: () => worker.installer.triggerRefs(),
		});
		const responder = serveTriggerValidation(
			s.project,
			"development",
			supervisor,
			worker.installer.triggerRefs,
		);
		try {
			await until(
				() => worker.status(),
				(status) => status[pluginStatusKey(s.project, NAME)]?.state === "ready",
			);
			supervisor.start();
			// the child serves once bootstrapped: its refs and app config are in by then
			for (let i = 0; i < 500; i++) {
				if (await fetch(`http://127.0.0.1:${port}`).then(() => true, () => false)) break;
				await Bun.sleep(20);
			}

			const refused = await create();
			expect(refused.status).toBe(400);
			expect(JSON.stringify(refused.body)).toContain(`table ${table} does not exist`);

			await sql.unsafe(`CREATE TABLE ${table} (id serial PRIMARY KEY)`);
			const empty = await create();
			expect(empty.status).toBe(200);
			expect(empty.body.warnings).toEqual([`table ${table} is empty`]);

			await sql.unsafe(`INSERT INTO ${table} DEFAULT VALUES`);
			const accepted = await create();
			expect([accepted.status, accepted.body.warnings]).toEqual([200, []]);
		} finally {
			await responder.stop();
			supervisor.stop();
			const child = supervisor.child();
			child?.kill();
			await child?.exited;
			await worker.stop();
		}
	}, 180_000);
});
