import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PluginArtifact } from "../../../compiler/artifacts";
import { hashFiles } from "../../sources/integrity";
import { readTree } from "../../sources/tree";
import { blockMetaOf } from "../../meta";
import { entry, manifest } from "../../tests/fixtures";

export const NAME = "acme/echo";
export const TYPE = `${NAME}/step`;
const ENTRY = "dist/blocks/step.js";

/** a built plugin in `<root>/<dir>` with no dependencies, whose block answers `tag` */
export function writeFsPlugin(
	root: string,
	dir: string,
	{ tag, version }: { tag: string; version: string },
) {
	const files: Record<string, string> = {
		"package.json": JSON.stringify({ name: "@acme/echo", version }),
		"bun.lock": "{}",
		"fluxify.json": JSON.stringify(manifest(NAME, [entry(TYPE)])),
		[ENTRY]: `export default { run: () => ({ output: ${JSON.stringify(tag)}, handle: "success" }) };`,
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, dir, path)), { recursive: true });
		writeFileSync(join(root, dir, path), text);
	}
}

/** what the admin publishes for the directory as it is now */
export async function fsArtifact(
	root: string,
	dir: string,
	over: Partial<PluginArtifact> = {},
): Promise<PluginArtifact> {
	const pkg = JSON.parse(await Bun.file(join(root, dir, "package.json")).text());
	return {
		projectId: "p1",
		name: NAME,
		version: pkg.version,
		integrity: hashFiles(await readTree(join(root, dir))),
		source: "fs",
		location: dir,
		approval: "approved",
		permissions: { integrations: [], appconfig: false },
		blocks: { [TYPE]: { entry: ENTRY, meta: blockMetaOf(entry(TYPE) as never) } },
		publishedAt: new Date().toISOString(),
		...over,
	};
}
