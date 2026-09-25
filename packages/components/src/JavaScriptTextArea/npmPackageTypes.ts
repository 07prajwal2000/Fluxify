import { useEffect } from "react";

/**
 * Autocomplete for a project's installed npm packages (#477): fetches each
 * package's own `.d.ts` files — or its `@types/*` package when it ships none —
 * from jsDelivr and registers them under `node_modules/<pkg>`, so
 * `import x from "<pkg>"` resolves in the editor as it does on a worker.
 * A types package's own `dependencies` (e.g. `@types/bun` -> `bun-types`,
 * `@types/node`) load the same way, once per name.
 */
const CDN = "https://cdn.jsdelivr.net/npm";
const LISTING = "https://data.jsdelivr.com/v1/packages/npm";
const MAX_FILES = 300;
const DECLARATION = /\.d\.(ts|mts|cts)$/;

export type InstalledPackage = { name: string; version: string | null };

const loaded = new Map<string, Promise<void>>();
/** transitive type dependencies, deduped by name */
const deps = new Map<string, Promise<void>>();

let installed: string[] = [];
/** importable subpaths (`nanoid/non-secure`, `dayjs/plugin/utc`) per package, known once its types load */
const subpaths = new Map<string, string[]>();

/** what the import-specifier completion offers (see setup.ts); Monaco's TS worker can't list `node_modules` itself */
export function importSpecifiers(): string[] {
	return installed.flatMap((name) => [name, ...(subpaths.get(name) ?? [])]);
}

function subpathsOf(name: string, manifest: { exports?: unknown }, paths: string[]) {
	const { exports } = manifest;
	if (
		exports &&
		typeof exports === "object" &&
		Object.keys(exports).some((k) => k.startsWith("."))
	) {
		return Object.keys(exports)
			.filter((k) => k.startsWith("./") && !k.includes("*") && !k.endsWith(".json"))
			.map((k) => name + k.slice(1));
	}
	const specifiers = paths
		.filter((p) => DECLARATION.test(p) && !/^\/(esm|cjs)\//.test(p))
		.map((p) => name + p.replace(DECLARATION, "").replace(/\/index$/, ""))
		.filter((s) => s !== name);
	return [...new Set(specifiers)];
}

function typesPackage(name: string) {
	return `@types/${name.startsWith("@") ? name.slice(1).replace("/", "__") : name}`;
}

/** a CDN error page must never be registered as a `.d.ts`, and a stalled request must end */
async function get(url: string) {
	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`${url}: ${res.status}`);
	return res;
}

const json = async (url: string) => (await get(url)).json();

/** registers `source@version`'s declarations as if they were `name`'s */
async function registerFrom(name: string, source: string, version: string) {
	const listing = await json(`${LISTING}/${source}@${version}?structure=flat`);
	const paths: string[] = listing.files
		.map((f: { name: string }) => f.name)
		.filter((p: string) => DECLARATION.test(p) || p === "/package.json")
		.slice(0, MAX_FILES);
	const files = await Promise.all(
		paths.map(async (path) => ({
			virtualPath: `file:///node_modules/${name}${path}`,
			content: await (await get(`${CDN}/${source}@${version}${path}`)).text(),
		})),
	);
	const { registerTypeLibFiles } = await import("./typeLibRegistry");
	registerTypeLibFiles(`npm:${name}`, files);
	const file = files.find((f) => f.virtualPath.endsWith(`${name}/package.json`));
	const manifest = file ? JSON.parse(file.content) : {};
	subpaths.set(name, subpathsOf(name, manifest, paths));
	await Promise.all(
		Object.entries<string>(manifest.dependencies ?? {}).map(([dep, range]) =>
			loadDependency(dep, minVersion(range)),
		),
	);
}

/** lowest version a range allows (`^1.2.3` -> `1.2.3`), else `latest` */
export function minVersion(range: string) {
	return range.match(/\d+\.\d+\.\d+(-[\w.]+)?/)?.[0] ?? "latest";
}

function loadDependency(name: string, version: string) {
	if (!deps.has(name))
		deps.set(
			name,
			registerFrom(name, name, version).catch((error) => {
				console.warn(`[JavaScriptTextArea] no types for "${name}"`, error);
			}),
		);
	return deps.get(name);
}

async function loadTypes({ name, version }: InstalledPackage) {
	const v = version ?? "latest";
	const manifest = await json(`${CDN}/${name}@${v}/package.json`);
	if (manifest.types || manifest.typings) return registerFrom(name, name, v);
	// no bundled types: the DefinitelyTyped package, matched on the major version
	const major = v.split(".")[0];
	const types = typesPackage(name);
	const ok = await get(`${CDN}/${types}@${major}/package.json`).then(
		() => true,
		() => false,
	);
	return registerFrom(name, types, ok ? major : "latest");
}

/** keeps the editor's package types in step with what the project has installed */
export function useNpmPackageTypes(
	packages: InstalledPackage[] | undefined,
	/** the server's `Bun.version`: loads the matching `@types/bun` once */
	bunVersion?: string,
) {
	useEffect(() => {
		if (bunVersion) loadDependency("@types/bun", bunVersion);
	}, [bunVersion]);
	const key = JSON.stringify(packages ?? []);
	useEffect(() => {
		const list: InstalledPackage[] = JSON.parse(key);
		installed = list.map((p) => p.name);
		for (const pkg of list) {
			const id = `${pkg.name}@${pkg.version}`;
			if (loaded.has(id)) continue;
			loaded.set(
				id,
				loadTypes(pkg).catch((error) => {
					// untyped beats a broken editor; do not retry on every render
					console.warn(`[JavaScriptTextArea] no types for "${pkg.name}"`, error);
				}),
			);
		}
	}, [key]);
}

/**
 * Types for one package the editor itself hands to user code (e.g. zod as
 * `t.zod` in test suites), loaded once and without touching the project's
 * import list.
 */
export function usePackageTypes(name: string, version: string) {
	useEffect(() => {
		loadDependency(name, version);
	}, [name, version]);
}
