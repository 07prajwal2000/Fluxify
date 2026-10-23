// The npm package, in dist/: ESM bundles (zod and the AI SDK stay peers), declarations,
// and a package.json whose exports point at them. The workspace keeps using
// the TS source, so nothing here affects it. Pack or publish from dist/.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

const built = await Bun.build({
	entrypoints: [`${root}/index.ts`, `${root}/blocks.ts`, `${root}/integrations.ts`],
	outdir: dist,
	format: "esm",
	// no Node or Bun APIs: the admin and the portal import the schemas too
	target: "browser",
	splitting: true,
	external: ["zod", "ai", "@ai-sdk/provider"],
});
if (!built.success) throw new AggregateError(built.logs, "bundle failed");
// the test harness and the runtime contract it shares with the engine use node APIs
const node = await Bun.build({
	entrypoints: [`${root}/testing.ts`, `${root}/runtime.ts`],
	outdir: dist,
	format: "esm",
	target: "node",
	splitting: true,
	external: ["zod", "ai", "@ai-sdk/provider"],
});
if (!node.success) throw new AggregateError(node.logs, "bundle failed");
await $`bun x tsgo -p ${root}/tsconfig.build.json`;

const pkg = await Bun.file(`${root}/package.json`).json();
const entry = (name: string) => ({ types: `./${name}.d.ts`, import: `./${name}.js` });
await Bun.write(
	`${dist}/package.json`,
	`${JSON.stringify(
		{
			name: pkg.name,
			version: pkg.version,
			description: pkg.description,
			type: "module",
			license: pkg.license,
			author: pkg.author,
			repository: pkg.repository,
			exports: {
				".": entry("index"),
				"./blocks": entry("blocks"),
				"./integrations": entry("integrations"),
				"./testing": entry("testing"),
				"./runtime": entry("runtime"),
			},
			types: "./index.d.ts",
			files: ["**/*.js", "**/*.d.ts"],
			sideEffects: false,
			peerDependencies: pkg.peerDependencies,
			publishConfig: { access: "public" },
		},
		null,
		"\t",
	)}\n`,
);
console.log(`built ${pkg.name}@${pkg.version} in dist/`);
