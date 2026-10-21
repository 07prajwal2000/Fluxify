import { expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The authoring docs quote this plugin. A snippet starts with `// source: <repo path>`,
// and each of its lines must be a line of that file, in order (blank lines and
// `// ...` are skipped, so a snippet may leave parts out). Change a block and the
// page that quotes it fails here, instead of going stale.

const ROOT = join(import.meta.dir, "../../../..");
const PAGES = join(ROOT, "docs/plugins/authoring");

const snippets = readdirSync(PAGES)
	.filter((f) => f.endsWith(".md"))
	.flatMap((page) => {
		const text = readFileSync(join(PAGES, page), "utf8");
		return [...text.matchAll(/```\w*\n\/\/ source: (\S+)\n([\s\S]*?)```/g)].map((m) => ({
			page,
			source: m[1]!,
			lines: m[2]!.split("\n").map((l) => l.trim()),
		}));
	});

it("finds the snippets", () => {
	expect(snippets.length).toBeGreaterThan(0);
});

for (const { page, source, lines } of snippets) {
	it(`${page}: the snippet from ${source} matches it`, async () => {
		const file = (await Bun.file(join(ROOT, source)).text()).split("\n").map((l) => l.trim());
		let at = 0;
		for (const line of lines) {
			if (!line || line === "// ...") continue;
			const found = file.indexOf(line, at);
			expect(found, `not in ${source} (after line ${at}): ${line}`).toBeGreaterThanOrEqual(0);
			at = found + 1;
		}
	});
}
