import { expect, it } from "bun:test";
import { join } from "node:path";

// Each costs megabytes in both worker processes, every project; they load on first use (#944).
const LAZY = ["mongodb", "bson", "mysql2", "@ai-sdk/openai", "@ai-sdk/anthropic", "@ai-sdk/google", "@modelcontextprotocol/sdk"];

const packageOf = (file: string) => file.match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1];

/** The packages a bundle evaluates at start-up: what its entry reaches through static imports. */
async function startupPackages(entry: string) {
	const built = await Bun.build({
		entrypoints: [entry],
		target: "bun",
		conditions: ["module"],
		metafile: true,
	});
	expect(built.success).toBe(true);
	const inputs = built.metafile!.inputs;
	const start = Object.keys(inputs).find((file) => entry.replaceAll("\\", "/").endsWith(file))!;
	const seen = new Set([start]);
	for (const file of seen)
		for (const { path, kind } of inputs[file]?.imports ?? []) {
			// a CommonJS package's top-level `require` runs when the package does
			const eager =
				kind === "import-statement" || (kind === "require-call" && file.includes("node_modules"));
			if (eager && inputs[path]) seen.add(path);
		}
	return new Set([...seen].map(packageOf).filter(Boolean));
}

it.each([
	["supervisor", "../../../../deployments/compiledWorker.ts"],
	["execution process", "../executionProcess.ts"],
])("the %s loads no database driver, AI provider SDK or MCP SDK at start-up", async (_, entry) => {
	const loaded = await startupPackages(join(import.meta.dir, entry));
	expect(LAZY.filter((pkg) => loaded.has(pkg))).toEqual([]);
}, 60_000);
