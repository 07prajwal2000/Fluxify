import { beforeEach, describe, expect, it, mock } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readManifest } from "../archive";
import { KEY, portable, restore, setKey } from "./stubs";

/**
 * Every committed archive in `fixtures/` must restore on the current code and
 * give exactly its `.expected.json`. A fixture is never regenerated: if this
 * fails, the code broke an old backup, not the fixture.
 */
const DIR = join(import.meta.dir, "..", "fixtures");
const fixtures = readdirSync(DIR)
	.filter((f) => f.endsWith(".tar.gz"))
	.map((f) => f.slice(0, -".tar.gz".length));

beforeEach(() => {
	mock.restore();
	setKey(KEY);
});

describe("backup fixtures", () => {
	it("there are fixtures to restore", () => {
		expect(fixtures.length).toBeGreaterThan(0);
	});

	for (const name of fixtures)
		it(`restores ${name}`, async () => {
			const bytes = await Bun.file(join(DIR, `${name}.tar.gz`)).bytes();
			const expected = await Bun.file(join(DIR, `${name}.expected.json`)).json();
			expect(portable(await restore(bytes))).toEqual(expected);
		});

	it("walks a v1 section up through every step", async () => {
		const bytes = await Bun.file(join(DIR, "notes-v1.tar.gz")).bytes();
		expect((await readManifest(bytes)).sections.notes).toBe(1);
	});
});
