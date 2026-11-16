/**
 * Writes the stub-module fixtures that `tests/fixtures.spec.ts` restores. A
 * fixture is a record of what an older Fluxify wrote, so this never overwrites
 * one: add a new entry for a new format version, never edit an old one.
 *
 *   bun apps/server/src/modules/projectBackup/fixtures/make.ts
 */
import { join } from "node:path";
import { archiveOf, KEY, setKey } from "../tests/stubs";

type Fixture = {
	mode: "backup" | "template";
	sections: Record<string, [number, unknown]>;
	files?: Record<string, string>;
	/** the restored project, by name (see `portable` in tests/stubs.ts) */
	expected: unknown;
};

const FIXTURES: Record<string, Fixture> = {
	"notes-v1": {
		mode: "template",
		sections: {
			tags: [1, { tags: [{ name: "red", color: "#f00" }] }],
			notes: [1, { notes: ["first", "second"] }],
		},
		expected: {
			tags: [{ name: "red", color: "#f00" }],
			notes: [
				{ title: "first", tag: null, secret: "" },
				{ title: "second", tag: null, secret: "" },
			],
			attachments: {},
		},
	},
	"notes-v2": {
		mode: "template",
		sections: {
			tags: [1, { tags: [{ name: "red", color: "#f00" }] }],
			notes: [2, { notes: [{ title: "first", tag: "red" }] }],
		},
		expected: {
			tags: [{ name: "red", color: "#f00" }],
			notes: [{ title: "first", tag: "red", secret: "" }],
			attachments: {},
		},
	},
	"notes-v3-backup": {
		mode: "backup",
		sections: {
			tags: [1, { tags: [{ name: "red", color: "#f00" }] }],
			notes: [3, { notes: [{ title: "first", tag: "red", secret: "s3cret" }] }],
		},
		files: { "files/notes/first.txt": "hello" },
		expected: {
			tags: [{ name: "red", color: "#f00" }],
			notes: [{ title: "first", tag: "red", secret: "s3cret" }],
			attachments: { "first.txt": "hello" },
		},
	},
	/** from before `notes` existed: the section is absent and restores as empty */
	"tags-only": {
		mode: "template",
		sections: { tags: [1, { tags: [{ name: "red", color: "#f00" }] }] },
		expected: { tags: [{ name: "red", color: "#f00" }], notes: [], attachments: {} },
	},
};

setKey(KEY);
for (const [name, { mode, sections, files, expected }] of Object.entries(FIXTURES)) {
	const archive = join(import.meta.dir, `${name}.tar.gz`);
	if (await Bun.file(archive).exists()) continue;
	await Bun.write(archive, (await archiveOf(sections, mode, files)).bytes);
	await Bun.write(
		join(import.meta.dir, `${name}.expected.json`),
		`${JSON.stringify(expected, null, "\t")}\n`,
	);
	console.log(`wrote ${name}`);
}
