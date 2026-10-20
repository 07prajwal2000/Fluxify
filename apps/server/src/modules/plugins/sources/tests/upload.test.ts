// Plugin sources (#858): a tarball lands in the Object Store byte for byte and is
// registered pending, and a directory is hashed by its content. A mock would
// prove what we send; the Object Store proves what a worker would download.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TARBALL_BYTES } from "../limits";
import { keyOf, readAsWorker, sameBytes, setup, short, startStack, stopStack } from "./stack";
import { entry, manifest } from "../../tests/fixtures";
import { NAME, packageWith, pluginFiles, pluginTgz, VERSION } from "./tarball";

let db: Awaited<ReturnType<typeof startStack>>["sql"];
beforeAll(async () => {
	db = (await startStack("upload")).sql;
}, 240_000);
afterAll(stopStack);
afterEach(() => {
	delete process.env.FLUXIFY_PLUGINS_DIR;
});

describe("upload", () => {
	it("applies the migration: the url requests table and the plugins setting are there", async () => {
		const [row] = await db`SELECT to_regclass('public.plugin_url_requests') AS t`;
		expect(row.t).toBe("plugin_url_requests");
		const [enumRow] = await db`SELECT 'plugins'::instance_setting_category AS c`;
		expect(enumRow.c).toBe("plugins");
	});

	it("stores the tarball byte for byte, registers it pending and a worker can read it", async () => {
		const s = await setup();
		const tgz = pluginTgz();
		const res = await s.upload(tgz);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			name: "acme/echo",
			version: VERSION,
			source: "upload",
			location: keyOf(s.project),
			approval: "pending",
			prodEnabled: false,
		});
		const hash = `sha256-${new Bun.CryptoHasher("sha256").update(tgz).digest("base64")}`;
		expect(res.body.integrity).toBe(hash);

		const stored = await readAsWorker(keyOf(s.project));
		expect(sameBytes(stored, tgz)).toBe(true);
		expect(await s.rows()).toHaveLength(1);
	});

	it("stores a block's icon as a data URL, in the row and in the API", async () => {
		const s = await setup();
		const png = new Uint8Array([137, 80, 78, 71]);
		const tgz = pluginTgz({
			"fluxify.json": JSON.stringify(manifest(NAME, [entry(`${NAME}/step`, { icon: "icons/step.png" })])),
			"icons/step.png": png,
		});
		const res = await s.upload(tgz);
		expect(res.status).toBe(200);
		const url = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
		expect(res.body.manifest.blocks[`${NAME}/step`].icon).toBe(url);
		const [row] = await s.rows();
		expect(row.manifest.blocks[`${NAME}/step`].icon).toBe(url);
	});

	it("round-trips a tarball larger than the server's max_payload", async () => {
		const s = await setup();
		// random bytes do not compress: ~3 MB on the wire, three times a KV value's limit
		const tgz = pluginTgz({ "dist/blocks/big.bin": crypto.getRandomValues(new Uint8Array(3_000_000)) });
		expect(tgz.length).toBeGreaterThan(2_900_000);
		expect((await s.upload(tgz)).status).toBe(200);
		const stored = await readAsWorker(keyOf(s.project));
		expect(sameBytes(stored, tgz)).toBe(true);
	});

	it("registering the same tarball again changes nothing", async () => {
		const s = await setup();
		const tgz = pluginTgz();
		const first = await s.upload(tgz);
		const again = await s.upload(tgz);
		expect(again.body.id).toBe(first.body.id);
		expect(again.body.updatedAt).toBe(first.body.updatedAt);
		expect(await s.rows()).toHaveLength(1);
	});

	it("new code at the same version puts an approved plugin back to pending", async () => {
		const s = await setup();
		await s.upload(pluginTgz());
		expect((await s.post("/acme/echo/approve", {})).body.approval).toBe("approved");
		const changed = await s.upload(pluginTgz({ "dist/blocks/step.js": "export default { v: 2 };" }));
		expect(changed.body.approval).toBe("pending");
		const stored = await readAsWorker(keyOf(s.project));
		expect(sameBytes(stored, pluginTgz({ "dist/blocks/step.js": "export default { v: 2 };" }))).toBe(true);
	});

	it("needs a creator", async () => {
		const s = await setup();
		expect((await s.upload(pluginTgz(), "viewer")).status).toBe(403);
		expect(await s.rows()).toHaveLength(0);
	});

	it("refuses what is not a plugin, storing and registering nothing", async () => {
		const s = await setup();
		const res = await s.upload(new TextEncoder().encode("not a tarball"));
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("not a valid .tgz");
		const noLock = pluginTgz({ "bun.lock": null, "package.json": packageWith({ ms: "2.1.3" }) });
		expect((await s.upload(noLock)).body.message).toContain("bun.lock is missing");
		expect(await readAsWorker(keyOf(s.project))).toBeNull();
		expect(await s.rows()).toHaveLength(0);
	});

	it("needs the file field", async () => {
		const s = await setup();
		const res = await s.post("/upload", new FormData());
		expect(res.status).toBe(400);
	});

	it("refuses a file over the compressed cap, and a request far over it", async () => {
		const s = await setup();
		const over = await s.upload(new Uint8Array(MAX_TARBALL_BYTES + 1024));
		expect(over.status).toBe(400);
		expect(over.body.message).toContain("larger than");
		const huge = await s.upload(new Uint8Array(MAX_TARBALL_BYTES + 2 * 1024 * 1024));
		expect(huge.status).toBe(413);
		expect(await s.rows()).toHaveLength(0);
	});
});

describe("fs", () => {
	let root = "";
	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "fluxify-plugins-"));
	});
	afterAll(() => rm(root, { recursive: true, force: true }));

	async function writePlugin(dir: string, over: Parameters<typeof pluginFiles>[0] = {}) {
		for (const [name, data] of Object.entries(pluginFiles(over))) {
			await mkdir(join(root, dir, name, ".."), { recursive: true });
			await writeFile(join(root, dir, name), data);
		}
	}

	it("is off until the directory is set", async () => {
		const s = await setup();
		const res = await s.get("/fs/discover");
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("FLUXIFY_PLUGINS_DIR");
	});

	it("lists plugin directories, and registers one as pending", async () => {
		process.env.FLUXIFY_PLUGINS_DIR = root;
		const dir = `echo-${short()}`;
		await writePlugin(dir);
		await mkdir(join(root, `notes-${short()}`), { recursive: true });
		const broken = `broken-${short()}`;
		await mkdir(join(root, broken), { recursive: true });
		await writeFile(join(root, broken, "fluxify.json"), "{");

		const s = await setup();
		const found = (await s.get("/fs/discover")).body;
		expect(found.find((c: any) => c.path === dir)).toEqual({ path: dir, name: "acme/echo", version: VERSION });
		expect(found.find((c: any) => c.path === broken).error).toContain("Cannot read");
		expect(found.filter((c: any) => c.path.startsWith("notes-"))).toEqual([]);

		const res = await s.post("/fs", { path: dir });
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			name: "acme/echo",
			source: "fs",
			location: dir,
			approval: "pending",
		});
		expect(res.body.integrity).toStartWith("sha256-");
	});

	it("hashes the content: a changed file is new code and needs approval again", async () => {
		process.env.FLUXIFY_PLUGINS_DIR = root;
		const dir = `echo-${short()}`;
		await writePlugin(dir);
		const s = await setup();
		const first = await s.post("/fs", { path: dir });
		expect((await s.post("/acme/echo/approve", {})).body.approval).toBe("approved");
		expect((await s.post("/fs", { path: dir })).body.integrity).toBe(first.body.integrity);

		await writeFile(join(root, dir, "dist/blocks/step.js"), "export default { changed: true };");
		const changed = await s.post("/fs", { path: dir });
		expect(changed.body.integrity).not.toBe(first.body.integrity);
		expect(changed.body.approval).toBe("pending");
	});

	it("leaves node_modules out of the hash and the checks", async () => {
		process.env.FLUXIFY_PLUGINS_DIR = root;
		const dir = `echo-${short()}`;
		await writePlugin(dir);
		const s = await setup();
		const before = await s.post("/fs", { path: dir });
		await mkdir(join(root, dir, "node_modules/dep"), { recursive: true });
		await writeFile(join(root, dir, "node_modules/dep/index.js"), "1");
		const after = await s.post("/fs", { path: dir });
		expect(after.status).toBe(200);
		expect(after.body.integrity).toBe(before.body.integrity);
	});

	it("applies the same checks as a tarball", async () => {
		process.env.FLUXIFY_PLUGINS_DIR = root;
		const dir = `nolock-${short()}`;
		await writePlugin(dir, { "bun.lock": null, "package.json": packageWith({ ms: "2.1.3" }) });
		const s = await setup();
		const res = await s.post("/fs", { path: dir });
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("bun.lock is missing");
	});

	it("only registers a directory the listing shows, never a path out of it", async () => {
		process.env.FLUXIFY_PLUGINS_DIR = root;
		const s = await setup();
		for (const path of ["..", "../x", "/etc", "a/../..", "missing"]) {
			const res = await s.post("/fs", { path });
			expect(res.status).toBe(400);
		}
		expect(await s.rows()).toHaveLength(0);
	});

	it("needs a creator", async () => {
		process.env.FLUXIFY_PLUGINS_DIR = root;
		const s = await setup();
		expect((await s.get("/fs/discover", "viewer")).status).toBe(403);
		expect((await s.post("/fs", { path: "x" }, "viewer")).status).toBe(403);
	});
});
