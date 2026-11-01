// The npm package, in dist/: one bundled bin.js and a package.json that lists
// only what it needs at run time. Bun-only (it uses Bun's APIs and loads the
// author's TypeScript). The workspace keeps running bin.ts. Pack or publish from dist/.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
// emptied, not removed: Windows refuses to delete a folder a shell is sitting in
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(dist)) rmSync(join(dist, name), { recursive: true, force: true });

const pkg = await Bun.file(`${root}/package.json`).json();
// the SDK in the repo is the one the CLI was tested against, so the package asks for exactly it
const sdk = await Bun.file(`${root}/../sdk/package.json`).json();

const built = await Bun.build({
	entrypoints: [`${root}/bin.ts`],
	outdir: dist,
	naming: "bin.js",
	format: "esm",
	target: "bun",
	// installed beside it, so they stay out of the bundle (oxc-parser is native)
	external: Object.keys(pkg.dependencies),
});
if (!built.success) throw new AggregateError(built.logs, "bundle failed");

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
			homepage: pkg.homepage,
			repository: pkg.repository,
			bin: { "fluxify-cli": "./bin.js" },
			files: ["bin.js"],
			dependencies: { ...pkg.dependencies, "@fluxify/sdk": sdk.version },
			publishConfig: { access: "public" },
		},
		null,
		"\t",
	)}\n`,
);
// the npm page shows the README in the package root
for (const file of ["README.md", "../../LICENSE"])
	copyFileSync(join(root, file), join(dist, basename(file)));
console.log(`built ${pkg.name}@${pkg.version} in dist/`);
