import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { faker } from "@faker-js/faker";
import { MemcachedIntegration } from "./memcached";
import type Docker from "dockerode";
import { docker, ensureImage, startContainerWithRandomPort } from "../containerTestHelpers";

const MEMCACHED_IMAGE = "memcached:1.6-alpine";

describe("MemcachedIntegration", () => {
	const containerName = "fluxify-memcached-test";
	let port: number;
	let container: Docker.Container | undefined;
	let integration: MemcachedIntegration;

	beforeAll(async () => {
		await docker.getContainer(containerName).remove({ force: true }).catch(() => {});
		await ensureImage(MEMCACHED_IMAGE);
		const started = await startContainerWithRandomPort((hostPort) =>
			docker.createContainer({
				Image: MEMCACHED_IMAGE,
				name: containerName,
				HostConfig: {
					PortBindings: { "11211/tcp": [{ HostPort: String(hostPort) }] },
				},
			}),
		);
		container = started.container;
		port = started.port;

		integration = new MemcachedIntegration({
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
		
		await new Promise((r) => setTimeout(r, 1500)); // Memcached resolution might be slightly slower
		result = await integration.get(key);
		expect(result).toBeNull();
	});

	it("should test connection successfully", async () => {
		const appConfigs = new Map<string, string>();
		const result = await MemcachedIntegration.TestConnection({
			host: "127.0.0.1",
			port: port,
			source: "credentials"
		}, appConfigs);
		
		expect(result.success).toBe(true);
	});
});
