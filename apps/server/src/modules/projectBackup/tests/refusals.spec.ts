import { beforeEach, describe, expect, it, mock } from "bun:test";
import { BadRequestError } from "../../../errors/badRequestError";
import { createBackup } from "../backup";
import { orderModules } from "../registry";
import {
	archiveOf,
	KEY,
	notes,
	OTHER_KEY,
	restore,
	STUBS,
	seedProject,
	store,
	tags,
	setKey,
} from "./stubs";

const v3 = { notes: [{ title: "a", tag: null, secret: "" }] };

beforeEach(() => {
	mock.restore();
	setKey(KEY);
});

/** every refusal is a 400 with this message, and leaves no project behind */
async function refused(tgz: Uint8Array | Promise<Uint8Array>, message: string, modules = STUBS) {
	const before = store.size;
	const error = await restore(await tgz, modules).catch((e) => e);
	expect(error).toBeInstanceOf(BadRequestError);
	expect(error.message).toContain(message);
	expect(store.size).toBe(before);
}

/** the archive's files, changed by `edit`, packed again with the manifest untouched */
async function repack(tgz: Uint8Array, edit: (files: Record<string, Uint8Array>) => void) {
	const files: Record<string, Uint8Array> = {};
	for (const [path, file] of await new Bun.Archive(tgz).files()) files[path] = await file.bytes();
	edit(files);
	return new Bun.Archive(files, { compress: "gzip" }).bytes();
}

const enc = new TextEncoder();

describe("restore refuses, writing nothing", () => {
	it("a section older than minSupported, naming the release that restores it", async () => {
		const strict = orderModules([tags, { ...notes, minSupported: 2, lastReleaseFor: { 1: "v0.4.0" } }]);
		const { bytes } = await archiveOf({ notes: [1, { notes: ["a"] }] });
		await refused(bytes, "Restore it on Fluxify v0.4.0", strict);
		await refused(bytes, "format v1, which this version of Fluxify no longer restores", strict);
	});

	it("a section newer than this instance knows", async () => {
		const { bytes } = await archiveOf({ notes: [4, v3] });
		await refused(bytes, "made by a newer version of Fluxify (format v4");
	});

	it("a section no module is registered for", async () => {
		const { bytes } = await archiveOf({ notes: [3, v3], workflows: [1, {}] });
		await refused(bytes, 'holds a "workflows" section');
	});

	it("a section that doesn't match its schema after upgrading", async () => {
		const { bytes } = await archiveOf({ notes: [3, { notes: [{ title: 1 }] }] });
		await refused(bytes, 'The "notes" section of this backup is invalid');
	});

	it("a template whose payload was altered (hash mismatch)", async () => {
		const { bytes } = await archiveOf({ notes: [3, v3] });
		const tampered = await repack(bytes, (files) => {
			files["sections/notes.json"] = enc.encode(JSON.stringify({ notes: [] }));
		});
		await refused(tampered, "damaged or was altered");
	});

	it("a backup made with another MASTER_ENCRYPTION_KEY", async () => {
		const { bytes } = await createBackup(
			{ projectId: seedProject(), source: { name: "x", slug: "x" }, mode: "backup" },
			STUBS,
		);
		setKey(OTHER_KEY);
		await refused(bytes, "different MASTER_ENCRYPTION_KEY");
	});

	it("an encrypted payload that was altered", async () => {
		const { bytes } = await archiveOf({ notes: [3, v3] }, "backup");
		const tampered = await repack(bytes, (files) => {
			files["payload.enc"]![40]! ^= 1;
		});
		await refused(tampered, "can't be decrypted");
	});

	it("an archive of another kind", async () => {
		const { bytes } = await archiveOf({ notes: [3, v3] });
		const route = await repack(bytes, (files) => {
			const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
			files["manifest.json"] = enc.encode(JSON.stringify({ ...manifest, kind: "fluxify.route" }));
		});
		await refused(route, "That isn't a Fluxify project backup.");
	});

	it("an archive envelope newer than this instance", async () => {
		const { bytes } = await archiveOf({ notes: [3, v3] });
		const future = await repack(bytes, (files) => {
			const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
			files["manifest.json"] = enc.encode(JSON.stringify({ ...manifest, format: 99 }));
		});
		await refused(future, "made by a newer version of Fluxify");
	});

	it("something that is not an archive", async () => {
		await refused(enc.encode("hello"), "not a .tar.gz archive");
		await refused(new Bun.Archive({ "readme.txt": "hi" }, { compress: "gzip" }).bytes(), "That isn't a Fluxify project backup.");
	});

	it("an import that fails halfway leaves no project", async () => {
		const failing = { ...notes, import: async () => Promise.reject(new Error("boom")) };
		const { bytes } = await archiveOf({ tags: [1, { tags: [{ name: "a", color: "#fff" }] }], notes: [3, v3] });
		const before = store.size;
		await expect(restore(bytes, orderModules([tags, failing]))).rejects.toThrow("boom");
		expect(store.size).toBe(before);
	});
});
