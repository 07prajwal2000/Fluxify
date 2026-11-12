import { beforeEach, describe, expect, it, mock } from "bun:test";
import { readManifest } from "../archive";
import { createBackup } from "../backup";
import { readBackup } from "../restore";
import {
	importLog,
	KEY,
	OTHER_KEY,
	portable,
	restore,
	STUBS,
	seedProject,
	store,
	tags,
	setKey,
} from "./stubs";

const source = { name: "Shop", slug: "shop" };

beforeEach(() => {
	mock.restore();
	setKey(KEY);
	importLog.length = 0;
});

describe("project backup round trip", () => {
	it("restores a backup into a new project with the same data, ids remapped by name", async () => {
		const from = seedProject();
		const { bytes, manifest } = await createBackup(
			{ projectId: from, source, mode: "backup" },
			STUBS,
		);
		expect(manifest.sections).toEqual({ tags: 1, notes: 3 });

		const to = await restore(bytes);
		expect(to).not.toBe(from);
		expect(portable(to)).toEqual(portable(from));
		// the note's tag points at the new project's tag, not the old id
		const copy = store.get(to)!;
		expect(copy.notes[0]!.tagId).toBe(copy.tags.find((t) => t.name === "blue")!.id);
		expect(copy.notes[0]!.tagId).not.toBe("t2");
	});

	it("imports in dependency order whatever order the modules were listed in", async () => {
		const { bytes } = await createBackup(
			{ projectId: seedProject(), source, mode: "template" },
			STUBS,
		);
		await restore(bytes);
		expect(importLog).toEqual(["tags", "notes"]);
	});

	it("a template drops secret values and can be restored with any key", async () => {
		const from = seedProject();
		const { bytes } = await createBackup(
			{ projectId: from, source, mode: "template", options: { includeAppConfigValues: true } },
			STUBS,
		);
		setKey(OTHER_KEY);
		const restored = portable(await restore(bytes));
		expect(restored.notes.map((n) => n.secret)).toEqual(["", ""]);
		expect(restored.attachments).toEqual(portable(from).attachments);
	});

	it("tells modules the mode and forces app config values off in a template", async () => {
		const seen: unknown[] = [];
		const spy = { ...tags, export: async (ctx: unknown) => (seen.push(ctx), { data: { tags: [] } }) };
		const projectId = seedProject();
		const options = { includeAppConfigValues: true, includeVersionHistory: true };
		await createBackup({ projectId, source, mode: "template", options }, [spy]);
		await createBackup({ projectId, source, mode: "backup", options }, [spy]);
		expect(seen).toEqual([
			{ projectId, mode: "template", options: { ...options, includeAppConfigValues: false } },
			{ projectId, mode: "backup", options },
		]);
	});

	it("keeps the manifest readable without the key, and shows no secret in it", async () => {
		const { bytes } = await createBackup(
			{ projectId: seedProject(), source, mode: "backup" },
			STUBS,
		);
		setKey(OTHER_KEY);
		const manifest = await readManifest(bytes);
		expect(manifest).toMatchObject({ kind: "fluxify.project", mode: "backup", source });
		expect(JSON.stringify(manifest)).not.toContain("s3cret");
	});

	it("exports only the selected sections; a section left out restores as empty", async () => {
		const { bytes, manifest } = await createBackup(
			{ projectId: seedProject(), source, mode: "backup", sections: ["notes"] },
			STUBS,
		);
		expect(manifest.sections).toEqual({ notes: 3 });
		const plan = await readBackup(bytes, STUBS);
		expect(plan.sections.map((s) => s.module.name)).toEqual(["notes"]);

		const copy = store.get(await restore(bytes))!;
		expect(copy.tags).toEqual([]);
		// the tag it named was not in the backup, so the reference is blank
		expect(copy.notes.map((n) => n.tagId)).toEqual([null, null]);
		expect(importLog).toEqual(["notes"]);
	});

	it("refuses to back up a section nobody registered", async () => {
		await expect(
			createBackup(
				{ projectId: seedProject(), source, mode: "backup", sections: ["routes"] },
				STUBS,
			),
		).rejects.toThrow('There is no "routes" section to back up.');
	});
});
