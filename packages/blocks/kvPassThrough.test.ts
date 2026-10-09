import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import type Docker from "dockerode";
import { KvFactory } from "@fluxify/adapters";
// subpath import on purpose: the container helpers are test-only and are
// deliberately not re-exported from the package barrel
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { BlockTypes } from "./blockTypes";
import { compileGraph } from "./compiler";
import type { BlockDTOType, EdgeDTOSchemaType } from "./builderTypes";

/**
 * Graph-level integration test for KV Operations passing its input through
 * (#663): a create-user route that stores the user in a real Redis and still
 * answers with the id it was given, instead of the old `true`.
 */

const REDIS_IMAGE = "valkey/valkey:8-alpine";
const REDIS_CONTAINER = "fluxify-kv-passthrough-redis-test";
const KV_ID = "kv-conn";

let redisContainer: Docker.Container | undefined;
let kvFactory: KvFactory;

async function removeIfPresent(name: string) {
	await docker.getContainer(name).remove({ force: true }).catch(() => {});
}

beforeAll(async () => {
	await removeIfPresent(REDIS_CONTAINER);
	await pullImage(REDIS_IMAGE);
	const redis = await startContainerWithRandomPort((hostPort) =>
		docker.createContainer({
			Image: REDIS_IMAGE,
			name: REDIS_CONTAINER,
			HostConfig: {
				PortBindings: { "6379/tcp": [{ HostPort: String(hostPort) }] },
			},
		}),
	);
	redisContainer = redis.container;
	kvFactory = new KvFactory({
		[KV_ID]: {
			variant: "Redis",
			host: "127.0.0.1",
			port: redis.port,
			source: "credentials",
		},
	});
}, 120_000);

afterAll(async () => {
	await KvFactory.ResetConnections().catch(() => {});
	await removeIfPresent(REDIS_CONTAINER);
	redisContainer = undefined;
});

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const edge = (from: string, to: string) => ({
	id: `edge-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: "source",
});

/** entrypoint -> KV Operations -> response, as a user wires it */
async function runKv(
	data: Record<string, unknown>,
	body: unknown,
	transformScript?: string,
) {
	const blocks = [
		block("in", BlockTypes.entrypoint),
		block("kv", BlockTypes.kv_operations, { connection: KV_ID, ...data }),
		block("out", BlockTypes.response, {
			httpCode: "201",
			transformEnabled: Boolean(transformScript),
			transformScript,
		}),
	];
	const edges: EdgeDTOSchemaType = [edge("in", "kv"), edge("kv", "out")];
	const { run } = compileGraph(blocks, edges);
	return run(
		{
			route: "/users",
			apiId: "api-1",
			projectId: "proj-1",
			vars: {},
			kvFactory,
			stopper: { timeoutEnd: 0, duration: 30_000 },
		} as any,
		body,
	);
}

const stored = (key: string) => kvFactory.getKvAdapter(KV_ID).get(key);

describe("kv operations output against a real Redis", () => {
	it("set lets the response read input.id, and stores the user", async () => {
		const key = `user:${faker.string.alphanumeric(8)}`;
		const user = { id: faker.string.uuid(), name: "ada" };

		// the create-user route from #663: it answered 201 {} when KV sent `true`
		const result = await runKv(
			{ operation: "set", key, useParam: true },
			user,
			"return { id: input.id };",
		);

		expect(result.output.httpCode).toBe("201");
		expect(result.output.body).toEqual({ id: user.id });
		expect(JSON.parse((await stored(key))!)).toEqual(user);
	});

	it("set with a fixed value still passes the input through", async () => {
		const key = `flag:${faker.string.alphanumeric(8)}`;
		const user = { id: faker.string.uuid() };

		const result = await runKv({ operation: "set", key, value: "on" }, user);

		expect(result.output.body).toEqual(user);
		expect(await stored(key)).toBe("on");
	});

	it("set with keepResult outputs input and true", async () => {
		const key = `user:${faker.string.alphanumeric(8)}`;
		const user = { id: faker.string.uuid() };

		const result = await runKv(
			{ operation: "set", key, value: "x", keepResult: true },
			user,
		);

		expect(result.output.body).toEqual({ input: user, result: true });
	});

	it("delete removes the key and passes the input through", async () => {
		const key = `user:${faker.string.alphanumeric(8)}`;
		const user = { id: faker.string.uuid() };
		await kvFactory.getKvAdapter(KV_ID).set(key, "there");

		const result = await runKv({ operation: "delete", key }, user);

		expect(result.output.body).toEqual(user);
		expect(await stored(key)).toBeNull();
	});

	it("delete with keepResult outputs input and true", async () => {
		const key = `user:${faker.string.alphanumeric(8)}`;
		const user = { id: faker.string.uuid() };

		const result = await runKv(
			{ operation: "delete", key, keepResult: true },
			user,
		);

		expect(result.output.body).toEqual({ input: user, result: true });
	});

	it("get returns the stored value, with or without keepResult", async () => {
		const key = `user:${faker.string.alphanumeric(8)}`;
		const user = { id: faker.string.uuid() };
		await kvFactory.getKvAdapter(KV_ID).set(key, JSON.stringify(user));

		const plain = await runKv({ operation: "get", key, parseJson: true }, { q: 1 });
		const kept = await runKv(
			{ operation: "get", key, parseJson: true, keepResult: true },
			{ q: 1 },
		);

		expect(plain.output.body).toEqual(user);
		expect(kept.output.body).toEqual({ input: { q: 1 }, result: user });
	});

	it("get of a missing key is null, and null result under keepResult", async () => {
		const key = `gone:${faker.string.alphanumeric(8)}`;

		const plain = await runKv({ operation: "get", key }, { q: 1 });
		const kept = await runKv({ operation: "get", key, keepResult: true }, { q: 1 });

		expect(plain.output.body).toBeNull();
		expect(kept.output.body).toEqual({ input: { q: 1 }, result: null });
	});
});
