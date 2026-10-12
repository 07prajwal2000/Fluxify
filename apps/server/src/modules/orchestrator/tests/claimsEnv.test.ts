// A development claim against a real Postgres (#742). Both things here are
// decided in SQL — the licence count is a `sum(...)` with a `where`, and the
// environment default is a column default — so a mock would only prove what the
// code says, not what the database answers. This runs the real migrations and
// writes claims through admin's own writer, checks and events included.
//
// `bun test apps/server/src/modules/orchestrator/tests/claimsEnv.test.ts` while
// developing; CI runs it with the integration suite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";

const IMAGE = "postgres:bullseye";
const NAME = "fluxify-claim-env-test";
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1";
let container: Docker.Container;
let client: SQL;
let claims: typeof import("../claims");

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(port) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	container = started.container;
	const base = `${ADMIN_URL}:${started.port}`;
	for (let attempt = 0; ; attempt++) {
		const probe = new SQL(`${base}/postgres`, { max: 1 });
		try {
			await probe`SELECT 1`;
			await probe.close();
			break;
		} catch (error) {
			await probe.close().catch(() => {});
			if (attempt >= 90) throw error;
			await Bun.sleep(500);
		}
	}

	const name = `t_${crypto.randomUUID().replaceAll("-", "")}`;
	const admin = new SQL(`${base}/postgres`, { max: 1 });
	await admin.unsafe(`CREATE DATABASE ${name}`);
	await admin.close();
	const url = `${base}/${name}`;
	client = new SQL(url, { max: 1 });

	// `lib/env` reads and caches `PG_URL` on its first import, so it is set here,
	// before the modules below are loaded — a static import would beat it.
	process.env.PG_URL = url;
	const { drizzleInit } = await import("../../../db");
	await drizzleInit(true);
	claims = await import("../claims");
}, 240_000);

afterAll(async () => {
	await client?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

// The licence this runs as allows one node, and every test here makes claims
// that spend it — so each starts from an empty table rather than from whatever
// the test before it left.
beforeEach(async () => {
	await client`TRUNCATE node_claims CASCADE`;
});

/** A catch-all claim, the only shape the community licence this test runs as allows. */
const catchAll = (over: Partial<Parameters<typeof claims.createClaim>[0]> = {}) =>
	claims.createClaim({ projectId: null, type: "both", groupIds: [], replicas: 1, ...over });

describe("a claim's environment (#742)", () => {
	it("is production for a row written without one — the column's default, not the code's guess", async () => {
		const id = "0192b1c4-0000-7000-8000-000000000001";
		await client`INSERT INTO node_claims (id, type, group_ids, replicas) VALUES (${id}, 'both', '[]'::jsonb, 1)`;
		const [row] = await client`SELECT env FROM node_claims WHERE id = ${id}`;
		expect(row.env).toBe("production");
		await client`DELETE FROM node_claims WHERE id = ${id}`;
	});

	it("is stored on create, and defaults to production when the caller names none", async () => {
		const prod = await catchAll();
		expect(prod.env).toBe("production");
		const dev = await catchAll({ env: "development" });
		expect(dev.env).toBe("development");
	});

	it("leaves a development claim's replicas out of the licence count", async () => {
		// Community runs one node, and the production claim is spending it.
		await catchAll();
		expect(await claims.countClaimedReplicas()).toBe(1);

		const dev = await catchAll({ env: "development", replicas: 3 });
		expect(await claims.countClaimedReplicas()).toBe(1);
		// And asking about anything other than the dev claim changes nothing.
		expect(await claims.countClaimedReplicas(dev.id)).toBe(1);
	});

	it("still counts a production claim's replicas, and leaves out the one being resized", async () => {
		const prod = await catchAll();
		expect(await claims.countClaimedReplicas()).toBe(1);
		expect(await claims.countClaimedReplicas(prod.id)).toBe(0);
	});

	it("accepts a development claim over the licence cap, and refuses the production one", async () => {
		await catchAll();
		await expect(catchAll({ replicas: 2 })).rejects.toThrow(/already claimed/);
		await expect(catchAll({ env: "development", replicas: 2 })).resolves.toMatchObject({
			env: "development",
		});
	});

	it("writes a project's development claim on community, which refuses the same claim in production", async () => {
		const projectId = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
		const groupId = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
		await client`INSERT INTO projects (id, slug) VALUES (${projectId}, ${`p-${projectId}`})`;
		await client`INSERT INTO trigger_groups (id, name, project_id) VALUES (${groupId}, 'grp', ${projectId})`;
		// A claim that serves APIs is reached on the project's own host, in either
		// environment, so the project has one.
		await client`INSERT INTO project_settings (id, project_id, key, value) VALUES (${`s-${projectId}`}, ${projectId}, 'settings.routing.subdomain', ${`s-${projectId}`})`;
		const project = {
			projectId,
			// `both` is what community licenses, so this is refused for the project
			// it names rather than for its type.
			type: "both" as const,
			groupIds: [groupId],
			replicas: 2,
		};

		// Community licenses the catch-all alone, so this claim is refused...
		await expect(claims.createClaim(project)).rejects.toThrow(/serve every project/);

		// ...and accepted as development, which spends no slot and is limited by
		// the pool rather than by the licence.
		const dev = await claims.createClaim({ ...project, env: "development" });
		expect(dev).toMatchObject({ projectId, env: "development", replicas: 2 });
		expect(await claims.countClaimedReplicas(dev.id)).toBe(0);
	});

	it("refuses a maximum on a development claim, while accepting one where the licence allows it", async () => {
		await expect(catchAll({ env: "development", maxReplicas: 2 })).rejects.toThrow(
			/never autoscales/,
		);
		// Community caps the node count, so a maximum above the floor is refused
		// there too — for the licence's reason, not the environment's.
		await expect(catchAll({ maxReplicas: 2 })).rejects.toThrow(/fixed number of nodes/);
	});

	it("can be turned development and back, which the row keeps", async () => {
		const claim = await catchAll();
		const dev = await claims.updateClaim(claim.id, { env: "development" }, { instance: true });
		expect(dev.env).toBe("development");
		const back = await claims.updateClaim(claim.id, { env: "production" }, { instance: true });
		expect(back.env).toBe("production");
	});
});
