import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { BLOCK_DOC_PAGES, toPanelMarkdown } from "./blockDocs";

describe("block docs", () => {
	test("every built-in block points at an existing page", () => {
		const dir = join(import.meta.dir, "../../../../../../../docs/blocks");
		const files = new Set(readdirSync(dir).map((f) => f.replace(/\.md$/, "")));
		for (const page of Object.values(BLOCK_DOC_PAGES)) expect(files.has(page)).toBe(true);
	});

	test("strips frontmatter, converts containers and links", () => {
		const out = toPanelMarkdown(
			"---\ntitle: X\n---\n\n# X\n\n::: tip Heads up\nSee [a](./db-insert.md#on-conflict), [b](/blocks/switch), [c](https://x.dev).\n:::\n\n::: warning\nno\n:::",
			"db-get-all",
		);
		expect(out).toBe(
			"# X\n\n:::tip[Heads up]\nSee [a](https://docs.fluxify.rest/blocks/db-insert.html#on-conflict), [b](https://docs.fluxify.rest/blocks/switch), [c](https://x.dev).\n:::\n\n:::warning\nno\n:::",
		);
	});
});
