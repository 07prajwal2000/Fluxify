import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createBackup } from "../backup";
import { orderModules } from "../registry";
import { readBackup, restoreBackup } from "../restore";
import type { BackupModule } from "../types";
import { KEY, notes, openProject, STUBS, seedProject, setKey, tags } from "./stubs";

const source = { name: "Shop", slug: "shop" };
const backup = async () =>
	(await createBackup({ projectId: seedProject(), source, mode: "template" }, STUBS)).bytes;

/** tags that warn about each tag, and refuse to "publish" the red one after the commit */
const warningTags: BackupModule = {
	...(tags as BackupModule),
	inspect: (data) => (data as { tags: { name: string }[] }).tags.map((t) => `tag ${t.name}`),
	async import(ctx, data) {
		await tags.import(ctx, data as Parameters<typeof tags.import>[1]);
		for (const { name } of (data as { tags: { name: string }[] }).tags)
			ctx.afterCommit(
				async () => {
					if (name === "red") throw new Error("broker down");
				},
				`Tag "${name}" could not be published.`,
			);
	},
};

beforeEach(() => {
	mock.restore();
	setKey(KEY);
});

describe("restore warnings", () => {
	it("a module without inspect adds nothing", async () => {
		const plan = await readBackup(await backup(), STUBS);
		expect(plan.warnings).toEqual([]);
		expect((await restoreBackup(plan, openProject)).warnings).toEqual([]);
	});

	it("collects inspect warnings in the plan, tagged by section, before anything is written", async () => {
		const plan = await readBackup(await backup(), orderModules([notes, warningTags]));
		expect(plan.warnings).toEqual([
			{ section: "tags", message: "tag red" },
			{ section: "tags", message: "tag blue" },
		]);
	});

	it("returns the plan's warnings plus each failed afterCommit task, and still restores", async () => {
		const plan = await readBackup(await backup(), orderModules([notes, warningTags]));
		const { projectId, warnings } = await restoreBackup(plan, openProject);
		expect(projectId).toBeString();
		expect(warnings).toEqual([
			...plan.warnings,
			{ section: "tags", message: 'Tag "red" could not be published.' },
		]);
	});
});
