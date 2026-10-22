import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { runIntegration } from "@fluxify/sdk/testing";
import type Docker from "dockerode";
import { Redis } from "ioredis";
import cache from "./cache";

const REDIS_IMAGE = "valkey/valkey:8-alpine";

/** a container that accepts TCP is not a Redis that answers commands yet */
async function waitForRedis(url: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const client = new Redis(url, {
			lazyConnect: true,
			maxRetriesPerRequest: 1,
			retryStrategy: () => null,
		});
		client.on("error", () => {});
		try {
			await client.connect();
			await client.ping();
			return;
		} catch {
			await Bun.sleep(100);
		} finally {
			client.disconnect();
		}
	}
	throw new Error("the Redis container did not answer PING");
}

describe("Redis cache variant", () => {
	const containerName = "fluxify-example-integrations-redis";
	let container: Docker.Container | undefined;
	let url: string;

	beforeAll(async () => {
		await docker.getContainer(containerName).remove({ force: true }).catch(() => {});
		await pullImage(REDIS_IMAGE);
		const started = await startContainerWithRandomPort((hostPort) =>
			docker.createContainer({
				Image: REDIS_IMAGE,
				name: containerName,
				HostConfig: { PortBindings: { "6379/tcp": [{ HostPort: String(hostPort) }] } },
			}),
		);
		container = started.container;
		url = `redis://127.0.0.1:${started.port}`;
		await waitForRedis(url);
	}, 60_000);

	afterAll(async () => {
		if (container) await container.remove({ force: true }).catch(() => {});
	});

	const open = (prefix = "") =>
		runIntegration(cache, {
			config: { url: "REDIS_URL", prefix },
			appConfig: { REDIS_URL: url },
		});

	it("round-trips text, misses as null, and prefixes its keys", async () => {
		const run = open("example:");
		try {
			const client = await run.client();
			const key = faker.string.alphanumeric(10);
			await client.set(key, "42");
			// the store hands text back, never a number
			expect(await client.get(key)).toBe("42");
			expect(await client.get(faker.string.alphanumeric(12))).toBeNull();
			// the prefixed key is the plain key with its prefix, not a namespace of its own
			const plain = open();
			try {
				const other = await plain.client();
				expect(await other.get(`example:${key}`)).toBe("42");
			} finally {
				await plain.close();
			}
			await client.delete(key);
			expect(await client.get(key)).toBeNull();
		} finally {
			await run.close();
		}
	});

	it("expires a setex key", async () => {
		const run = open();
		try {
			const client = await run.client();
			const key = faker.string.alphanumeric(10);
			await client.setex(key, 1, "soon gone");
			expect(await client.get(key)).toBe("soon gone");
			await Bun.sleep(1100);
			expect(await client.get(key)).toBeNull();
		} finally {
			await run.close();
		}
	});

	it("tests the connection through its own client", async () => {
		const run = open();
		expect(await run.test()).toEqual({ success: true });
	});

	it("hands the same client back inside one run", async () => {
		const run = open();
		try {
			expect(await run.client()).toBe(await run.client());
		} finally {
			await run.close();
		}
	});
});
