/**
 * Browser-side npm registry lookups for the install modal. Only for picking
 * a name and version: the admin resolves the real install, age rule included.
 * ponytail: always the public registry; follow NPM_REGISTRY_URL once private
 * registries land (#477 open items).
 */
const REGISTRY = "https://registry.npmjs.org";

export type NpmSearchHit = { name: string; version: string; description?: string };

export async function searchNpm(text: string, signal?: AbortSignal): Promise<NpmSearchHit[]> {
	const res = await fetch(`${REGISTRY}/-/v1/search?size=15&text=${encodeURIComponent(text)}`, {
		signal,
	});
	if (!res.ok) throw new Error(`npm search failed: ${res.status}`);
	const body = await res.json();
	return body.objects.map((o: { package: NpmSearchHit }) => ({
		name: o.package.name,
		version: o.package.version,
		description: o.package.description,
	}));
}

/** stable versions, newest first, each with its publish date */
export async function npmVersions(name: string): Promise<{ version: string; time: string }[]> {
	const res = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`);
	if (!res.ok) throw new Error(`npm lookup failed: ${res.status}`);
	const body = await res.json();
	return Object.keys(body.versions ?? {})
		.filter((v) => !v.includes("-"))
		.map((version) => ({ version, time: body.time?.[version] ?? "" }))
		.sort((a, b) => b.time.localeCompare(a.time));
}
