// Bundles the real PostgresAdapter without the rest of the db package: the "." barrel
// (which pulls in the MySQL and MongoDB drivers) is swapped for a slim one, and the
// mongodb driver, only used by the Mongo adapter and cursor tokens, is stubbed.
import { resolve } from "node:path";

const dbDir = resolve(import.meta.dir, "../../../../packages/adapters/db");
const sdkIntegrations = resolve(dbDir, "../../sdk/integrations.ts");
const lib = resolve(dbDir, "../../lib/index.ts");
const slim = resolve(import.meta.dir, "slimBarrel.ts");

const result = await Bun.build({
	entrypoints: [resolve(import.meta.dir, process.argv[2] ?? "index.ts")],
	outdir: resolve(import.meta.dir, process.argv[3] ?? "dist"),
	target: "bun",
	// NO_STUBS=1: the real packages, for entries that need the whole blocks library
	plugins: process.env.NO_STUBS
		? []
		: [
		{
			name: "slim-db",
			setup(b) {
				b.onResolve({ filter: /^\.$/ }, (a) =>
					a.importer.startsWith(dbDir) ? { path: slim } : undefined,
				);
				// the workspace packages, resolved by path because this folder is outside the workspace
				b.onResolve({ filter: /^@fluxify\/sdk\/integrations$/ }, () => ({ path: sdkIntegrations }));
				b.onResolve({ filter: /^@fluxify\/lib$/ }, () => ({ path: lib }));
				// the Mongo adapter is only touched by an `instanceof` check in the native-db block
				b.onResolve({ filter: /^@fluxify\/adapters$/ }, () => ({ path: "adapters", namespace: "stub" }));
				b.onResolve({ filter: /^mongodb$/ }, () => ({ path: "mongodb", namespace: "stub" }));
				b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
					contents:
						a.path === "adapters"
							? "export class MongoAdapter {}; export class ObjectId {}; export const sessionBoundDb = () => { throw new Error('no mongo'); };"
							: "export class Decimal128 {}; export class Long {}; export class ObjectId {}; export const BSON = {};",
					loader: "js",
				}));
			},
		},
	],
});
if (!result.success) {
	for (const l of result.logs) console.error(l);
	process.exit(1);
}
for (const o of result.outputs) console.log(o.path, (o.size / 1048576).toFixed(2), "MB");
