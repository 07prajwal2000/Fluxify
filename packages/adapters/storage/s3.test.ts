import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type Docker from "dockerode";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import { integrationRegistry } from "../integrations";
import { S3_PART_SIZE, S3Storage, type S3Config, testS3Connection } from "./s3";

/**
 * The S3 Compatible adapter against a real MinIO. One container per run; each
 * test writes under its own random prefix so tests never see each other's keys.
 */

// MinIO no longer publishes images (Docker Hub and quay are gone); this is a
// community build of the same server that still ships `mc`.
const IMAGE = "pgsty/minio:RELEASE.2026-08-04T00-00-00Z";
const CONTAINER = "fluxify-s3-test";
const USER = "fluxifytest";
const PASS = "fluxifytest-secret";
const BUCKET = "fluxify-test";
const T = 60_000;

let container: Docker.Container | undefined;
let config: S3Config;
let storage: S3Storage;

const prefix = () => `t-${crypto.randomUUID().slice(0, 8)}/`;
const text = async (stream: ReadableStream<Uint8Array> | null) =>
	stream ? new Response(stream).text() : null;

async function exec(cmd: string[]) {
	const run = await container!.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
	const stream = await run.start({});
	await new Promise((resolve) => stream.on("end", resolve).resume());
	return (await run.inspect()).ExitCode;
}

beforeAll(async () => {
	await docker
		.getContainer(CONTAINER)
		.remove({ force: true })
		.catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			Cmd: ["server", "/data"],
			Env: [`MINIO_ROOT_USER=${USER}`, `MINIO_ROOT_PASSWORD=${PASS}`],
			HostConfig: { PortBindings: { "9000/tcp": [{ HostPort: String(port) }] } },
		}),
	);
	container = started.container;
	config = {
		endpoint: `http://127.0.0.1:${started.port}`,
		region: "us-east-1",
		bucket: BUCKET,
		accessKeyId: USER,
		secretAccessKey: PASS,
		forcePathStyle: true,
	};
	// a listening port is not a ready server: wait until mc can create the bucket
	for (let i = 0; i < 60; i++) {
		const code = await exec([
			"sh",
			"-c",
			`mc alias set local http://127.0.0.1:9000 ${USER} ${PASS} && mc mb --ignore-existing local/${BUCKET}`,
		]);
		if (code === 0) break;
		await Bun.sleep(500);
	}
	storage = new S3Storage(config);
}, 180_000);

afterAll(async () => {
	await container?.remove({ force: true }).catch(() => {});
});

describe("S3Storage against MinIO", () => {
	it(
		"puts, gets, heads, lists and deletes an object",
		async () => {
			const p = prefix();
			const key = `${p}hello.txt`;
			await storage.put(key, new TextEncoder().encode("hello"), { contentType: "text/plain" });

			expect(await text(await storage.get(key))).toBe("hello");
			const head = await storage.head(key);
			expect(head?.size).toBe(5);
			expect(head?.lastModified).toBeInstanceOf(Date);
			expect((await storage.list(p)).objects.map((o) => [o.key, o.size])).toEqual([[key, 5]]);

			await storage.delete(key);
			expect(await storage.get(key)).toBeNull();
			expect((await storage.list(p)).objects).toEqual([]);
		},
		T,
	);

	it(
		"returns null for a missing key, and deleting one is not an error",
		async () => {
			const key = `${prefix()}missing`;
			expect(await storage.get(key)).toBeNull();
			expect(await storage.head(key)).toBeNull();
			await storage.delete(key);
		},
		T,
	);

	it(
		"uploads a body above the part size in parts, from bytes and from a stream",
		async () => {
			const p = prefix();
			const size = S3_PART_SIZE * 2 + 1234;
			const bytes = new Uint8Array(size).map((_, i) => i % 251);

			await storage.put(`${p}bytes.bin`, bytes);
			await storage.put(`${p}stream.bin`, new Blob([bytes]).stream());

			for (const name of ["bytes.bin", "stream.bin"]) {
				const key = `${p}${name}`;
				const back = new Uint8Array(await new Response(await storage.get(key)).arrayBuffer());
				expect(back.byteLength).toBe(size);
				expect(Bun.hash(back)).toBe(Bun.hash(bytes));
				// a multipart upload's ETag ends in `-<number of parts>`
				expect((await storage.client.stat(key)).etag).toMatch(/-3"?$/);
			}
		},
		T * 2,
	);

	it(
		"lists a prefix one page at a time",
		async () => {
			const p = prefix();
			const keys = ["a", "b", "c", "d", "e"].map((k) => `${p}${k}`);
			await Promise.all(keys.map((k) => storage.put(k, new Uint8Array([1]))));
			await storage.put(`${prefix()}other`, new Uint8Array([1]));

			const seen: string[] = [];
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await storage.list(p, { limit: 2, cursor });
				seen.push(...page.objects.map((o) => o.key));
				cursor = page.cursor;
				pages++;
			} while (cursor);
			expect(seen).toEqual(keys);
			expect(pages).toBe(3);
		},
		T,
	);

	it(
		"reuses one client for every call",
		async () => {
			const client = storage.client;
			await storage.put(`${prefix()}x`, new Uint8Array([1]));
			await storage.list(prefix());
			expect(storage.client).toBe(client);
		},
		T,
	);

	it(
		"is built through the registry's create hook",
		async () => {
			const def = integrationRegistry.get("storage", "S3 Compatible")!;
			const adapter = def.create!(config, {}) as S3Storage;
			const key = `${prefix()}via-registry`;
			await adapter.put(key, new TextEncoder().encode("ok"));
			expect(await text(await storage.get(key))).toBe("ok");
		},
		T,
	);
});

describe("testS3Connection against MinIO", () => {
	it("succeeds with good config", async () => {
		expect(await testS3Connection(config)).toEqual({ success: true, error: "" });
	}, T);

	it("says the keys were refused", async () => {
		const result = await testS3Connection({ ...config, secretAccessKey: "wrong-secret" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("refused");
	}, T);

	it("says the access key is unknown", async () => {
		const result = await testS3Connection({ ...config, accessKeyId: "nobody" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("refused");
	}, T);

	it("says the bucket does not exist", async () => {
		const result = await testS3Connection({ ...config, bucket: "no-such-bucket" });
		expect(result).toEqual({ success: false, error: 'Bucket "no-such-bucket" does not exist.' });
	}, T);

	it("says the endpoint cannot be reached", async () => {
		const result = await testS3Connection({ ...config, endpoint: "http://127.0.0.1:1" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("Could not reach http://127.0.0.1:1");
	}, T);

	it("reading with bad keys throws instead of reading as missing", async () => {
		const bad = new S3Storage({ ...config, secretAccessKey: "wrong-secret" });
		await expect(bad.get(`${prefix()}x`)).rejects.toThrow();
	}, T);
});
