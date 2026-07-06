import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { faker } from "@faker-js/faker";
import { MemcachedIntegration } from "./memcached";

describe("MemcachedIntegration", () => {
	const containerName = "fluxify-memcached-test";
	const port = 11212;
	let integration: MemcachedIntegration;

	beforeAll(async () => {
		try { await $`docker stop ${containerName}`.quiet(); } catch {}
		try { await $`docker rm ${containerName}`.quiet(); } catch {}
		
		await $`docker run --name ${containerName} -p ${port}:11211 -d memcached:latest`;
		
		await new Promise((r) => setTimeout(r, 2000));

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
		try { await $`docker stop ${containerName}`.quiet(); } catch {}
		try { await $`docker rm ${containerName}`.quiet(); } catch {}
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
