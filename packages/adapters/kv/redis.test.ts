import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { faker } from "@faker-js/faker";
import { RedisIntegration } from "./redis";
import type Docker from "dockerode";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";

const REDIS_IMAGE = "valkey/valkey:8-alpine";

describe("RedisIntegration", () => {
	const containerName = "fluxify-redis-test";
	let port: number;
	let container: Docker.Container | undefined;
	let integration: RedisIntegration;

	beforeAll(async () => {
		await docker.getContainer(containerName).remove({ force: true }).catch(() => {});
		await pullImage(REDIS_IMAGE);
		const started = await startContainerWithRandomPort((hostPort) =>
			docker.createContainer({
				Image: REDIS_IMAGE,
				name: containerName,
				HostConfig: {
					PortBindings: { "6379/tcp": [{ HostPort: String(hostPort) }] },
				},
			}),
		);
		container = started.container;
		port = started.port;

		integration = new RedisIntegration({
			host: "127.0.0.1",
			port: port,
			source: "credentials"
		});
	});

	afterAll(async () => {
		if (integration) {
			await integration.disconnect();
		}
		if (container) await container.remove({ force: true }).catch(() => {});
	});

	it("should perform basic KV operations", async () => {
		const key = "basic_kv_" + faker.string.alphanumeric(10);
		const value = faker.string.uuid();

		await integration.set(key, value);
		
		const result = await integration.get(key);
		expect(result).toBe(value);

		await integration.delete(key);
		const afterDelete = await integration.get(key);
		expect(afterDelete).toBeNull();
	});

	it("should setex correctly", async () => {
		const key = "setex_" + faker.string.alphanumeric(10);
		const value = faker.string.uuid();

		await integration.setex(key, 1, value);
		let result = await integration.get(key);
		expect(result).toBe(value);
		
		await new Promise((r) => setTimeout(r, 1100));
		result = await integration.get(key);
		expect(result).toBeNull();
	});

	it("writes to the configured db index, isolated from db 0", async () => {
		const key = "db_index_" + faker.string.alphanumeric(10);
		const value = faker.string.uuid();
		const db2 = new RedisIntegration({
			host: "127.0.0.1",
			port: port,
			database: "2",
			source: "credentials",
		});
		try {
			await db2.set(key, value);
			expect(await db2.get(key)).toBe(value);
			// the default-db client must not see it
			expect(await integration.get(key)).toBeNull();
			await db2.delete(key);
		} finally {
			await db2.disconnect();
		}
	});

	it("resolves a cfg: db index from app config", () => {
		const resolved = RedisIntegration.ExtractConnectionInfo(
			{ host: "127.0.0.1", port: port, database: "cfg:REDIS_DB", source: "credentials" },
			new Map([["REDIS_DB", "3"]]),
		);
		expect(resolved.database).toBe("3");
	});

	it("should test connection successfully", async () => {
		const appConfigs = new Map<string, string>();
		const result = await RedisIntegration.TestConnection({
			host: "127.0.0.1",
			port: port,
			source: "credentials"
		}, appConfigs);
		
		expect(result.success).toBe(true);
	});
});
