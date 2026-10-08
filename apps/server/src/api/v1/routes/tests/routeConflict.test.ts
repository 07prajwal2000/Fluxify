// #672: which routes clash is the database query's job, so it runs against a real Postgres.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrateDB } from "../../../../db/migration";
import { findRouteConflict } from "../update/repository";

const PG = { image: "postgres:16-alpine", name: "fluxify-route-conflict-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let db: any;

beforeAll(async () => {
	await docker.getContainer(PG.name).remove({ force: true }).catch(() => {});
	await pullImage(PG.image);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: PG.image,
			name: PG.name,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	container = started.container;
	const url = `postgres://postgres:postgres@127.0.0.1:${started.port}/postgres`;
	for (let i = 0; ; i++) {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
			break;
		} catch (error) {
			if (i >= 90) throw error;
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
	await migrateDB(url);
	sql = new SQL(url);
	db = drizzle({ client: sql });
	await sql`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop'), ('p2', 'Other', 'other')`;
	await sql`INSERT INTO routes (id, project_id, name, method, path) VALUES
		('put', 'p1', 'update-user', 'PUT', '/users/:id'),
		('del', 'p1', 'delete-user', 'DELETE', '/users/:id'),
		('list', 'p1', 'get-users', 'GET', '/users')`;
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

const find = (route: { projectId?: string; name: string; method: string; path: string }, exclude?: string) =>
	findRouteConflict({ projectId: "p1", ...route }, exclude, db).then((r) => r?.id);

describe("findRouteConflict", () => {
	it("allows another method on a path that already has PUT and DELETE", async () => {
		expect(await find({ name: "get-user", method: "GET", path: "/users/:id" })).toBeUndefined();
		expect(await find({ name: "get-user", method: "GET", path: "/users/:userId" })).toBeUndefined();
	});

	it("rejects the same method on a path that differs only in param names or a trailing slash", async () => {
		expect(await find({ name: "x1", method: "PUT", path: "/users/:userId" })).toBe("put");
		expect(await find({ name: "x2", method: "GET", path: "/users/" })).toBe("list");
	});

	it("rejects a taken name in the same project only", async () => {
		expect(await find({ name: "update-user", method: "POST", path: "/other" })).toBe("put");
		expect(await find({ projectId: "p2", name: "update-user", method: "POST", path: "/other" })).toBeUndefined();
	});

	it("checks paths across projects, which share one URL space without a subdomain", async () => {
		expect(await find({ projectId: "p2", name: "x3", method: "PUT", path: "/users/:id" })).toBe("put");
	});

	it("ignores the route being updated", async () => {
		expect(await find({ name: "update-user", method: "PUT", path: "/users/:uid" }, "put")).toBeUndefined();
	});
});
