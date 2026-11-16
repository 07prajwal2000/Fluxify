import { beforeEach, describe, expect, it, mock } from "bun:test";
import { BadRequestError } from "../../../errors/badRequestError";
import { MAX_README_BYTES, readManifest } from "../archive";
import { createBackup } from "../backup";
import { readBackup } from "../restore";
import { KEY, OTHER_KEY, restore, STUBS, seedProject, setKey } from "./stubs";

const source = { name: "Shop", slug: "shop" };
const NOTE = "# Read me first\n\nRestore this on a **fresh** instance.\n";

beforeEach(() => {
	mock.restore();
	setKey(KEY);
});

const make = (mode: "backup" | "template", readme?: string) =>
	createBackup({ projectId: seedProject(), source, mode, readme }, STUBS);

/** the archive's files, changed by `edit`, packed again with the manifest untouched */
async function repack(tgz: Uint8Array, edit: (files: Record<string, Uint8Array>) => void) {
	const files: Record<string, Uint8Array> = {};
	for (const [path, file] of await new Bun.Archive(tgz).files()) files[path] = await file.bytes();
	edit(files);
	return new Bun.Archive(files, { compress: "gzip" }).bytes();
}

describe("archive README", () => {
	for (const mode of ["backup", "template"] as const) {
		it(`round trips in a ${mode}, readable without the key and kept by the plan`, async () => {
			const { bytes } = await make(mode, NOTE);
			setKey(OTHER_KEY);
			expect((await readManifest(bytes)).readme).toBe(NOTE);
			if (mode === "template") expect((await readBackup(bytes, STUBS)).readme).toBe(NOTE);
			setKey(KEY);
			expect((await readBackup(bytes, STUBS)).readme).toBe(NOTE);
			await restore(bytes);
		});
	}

	it("is a plain entry at the archive root, outside the sealed payload", async () => {
		const { bytes } = await make("backup", NOTE);
		const root = await new Bun.Archive(bytes).files();
		expect([...root.keys()].sort()).toEqual(["README.md", "manifest.json", "payload.enc"]);
		expect(await root.get("README.md")!.text()).toBe(NOTE);
	});

	it("is null when there is none, and a blank one counts as none", async () => {
		for (const readme of [undefined, "", "  \n "]) {
			const { bytes } = await make("template", readme);
			expect((await readManifest(bytes)).readme).toBeNull();
			expect((await readBackup(bytes, STUBS)).readme).toBeNull();
		}
	});

	it("stops at 64 KB, counted in bytes", async () => {
		const ok = "a".repeat(MAX_README_BYTES);
		expect((await readManifest((await make("template", ok)).bytes)).readme).toBe(ok);
		for (const over of ["a".repeat(MAX_README_BYTES + 1), "é".repeat(MAX_README_BYTES / 2 + 1)]) {
			const error = await make("template", over).catch((e) => e);
			expect(error).toBeInstanceOf(BadRequestError);
			expect(error.message).toContain("longer than 64 KB");
		}
	});

	it("refuses an archive whose README was edited, in both modes (the hash catches it)", async () => {
		for (const mode of ["backup", "template"] as const) {
			const { bytes } = await make(mode, NOTE);
			const edited = await repack(bytes, (f) => {
				f["README.md"] = new TextEncoder().encode("Run `rm -rf /` first.");
			});
			await expect(readBackup(edited, STUBS)).rejects.toThrow("damaged or was altered");
		}
	});

	it("refuses an archive whose README was added or removed", async () => {
		const plain = (await make("template")).bytes;
		const added = await repack(plain, (f) => {
			f["README.md"] = new TextEncoder().encode("hi");
		});
		await expect(readBackup(added, STUBS)).rejects.toThrow("damaged or was altered");

		const noted = (await make("template", NOTE)).bytes;
		const removed = await repack(noted, (f) => void delete f["README.md"]);
		await expect(readBackup(removed, STUBS)).rejects.toThrow("damaged or was altered");
	});

	it("refuses an oversize README before anything reads it further", async () => {
		const { bytes } = await make("template");
		const big = await repack(bytes, (f) => {
			f["README.md"] = new Uint8Array(MAX_README_BYTES + 1);
		});
		await expect(readManifest(big)).rejects.toThrow("longer than 64 KB");
	});
});
