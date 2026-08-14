import { registerTypeLibFiles } from "./typeLibRegistry";

interface PackageTypesManifest {
	/** Path (relative to the package root) TS should resolve `import "<pkg>"` to. */
	entry: string;
	/** Every declaration/package.json file to register, relative to the package root. */
	files: string[];
	/** Other package names this one's `/// <reference types="..." />` or imports need loaded first. */
	dependencies?: string[];
}

/**
 * Real `.d.ts`/`.d.cts` files for `libs.*` and community packages live as
 * static assets under `public/types/<pkg>/`, synced from node_modules by
 * `apps/portal/scripts/sync-type-libs.ts` — see that file to add a package.
 * Fetched once per package and registered under a virtual `node_modules/<pkg>`
 * path so `typeof import("<pkg>")` resolves the same way it would in a real
 * project.
 */
const loaded = new Map<string, Promise<void>>();

export function ensurePackageTypes(pkgName: string): Promise<void> {
	const existing = loaded.get(pkgName);
	if (existing) return existing;

	const promise = loadPackageTypes(pkgName).catch((err) => {
		// A missing/broken types package should degrade to no autocomplete for
		// that lib, not break the editor or retry forever on every render.
		console.warn(`[JavaScriptTextArea] failed to load types for "${pkgName}"`, err);
	});
	loaded.set(pkgName, promise);
	return promise;
}

async function loadPackageTypes(pkgName: string): Promise<void> {
	// The host app can be served under a non-root base (e.g. the portal's
	// `/_/admin/ui/`), so `public/` assets must be resolved against it rather
	// than a hardcoded root-relative path.
	const appBase = import.meta.env.BASE_URL ?? "/";
	const base = `${appBase.replace(/\/$/, "")}/types/${pkgName}`;
	const manifestRes = await fetch(`${base}/manifest.json`);
	if (!manifestRes.ok) throw new Error(`manifest fetch failed: ${manifestRes.status}`);
	const manifest: PackageTypesManifest = await manifestRes.json();

	await Promise.all((manifest.dependencies ?? []).map((dep) => ensurePackageTypes(dep)));

	const files = await Promise.all(
		manifest.files.map(async (relPath) => {
			const res = await fetch(`${base}/${relPath}`);
			if (!res.ok) throw new Error(`${relPath} fetch failed: ${res.status}`);
			return {
				virtualPath: `file:///node_modules/${pkgName}/${relPath}`,
				content: await res.text(),
			};
		}),
	);

	registerTypeLibFiles(`pkg:${pkgName}`, files);
}
