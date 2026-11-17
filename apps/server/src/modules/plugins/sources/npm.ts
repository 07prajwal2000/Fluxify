import { BadRequestError } from "../../../errors/badRequestError";
import { REGISTRY } from "../../packages/registryUrl";
import { assertPackageName } from "../../packages/resolver";
import { minReleaseAgeDays } from "../../packages/service";
import { registerSourced } from "./archive";
import { readCapped } from "./download";
import { verifyIntegrity } from "./integrity";
import { FETCH_TIMEOUT_MS } from "./limits";
import { untar } from "./tar";
import { validatePlugin } from "./validate";

/**
 * A plugin published to npm. Only `name@x.y.z` is accepted: a range or a tag
 * would let the version change under an approval. Whether the package is a
 * Fluxify plugin is read from its `fluxify.json` on jsDelivr before anything is
 * downloaded; the tarball from the registry is then checked against the
 * registry's own integrity hash and validated like any other source. Adding
 * one, with the plugins it depends on, is `dependencies.ts`.
 */
export type Packument = {
	time?: Record<string, string>;
	versions?: Record<string, { dist?: { tarball?: string; integrity?: string } }>;
};

export const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

/** `name@1.2.3` or `@scope/name@1.2.3` into its parts; anything else is refused */
export function parseSpec(spec: string) {
	const at = spec.lastIndexOf("@");
	const name = at > 0 ? spec.slice(0, at) : spec;
	const version = at > 0 ? spec.slice(at + 1) : "";
	if (!/^\d+\.\d+\.\d+$/.test(version))
		throw new BadRequestError(
			`Give an exact version, like ${name || "my-plugin"}@2026.10.2001. Ranges and tags (latest, ^1.0.0) are not accepted: the approval is for one exact version.`,
		);
	assertPackageName(name);
	return { name, version };
}

/** the package's registry document; a 404 is a BadRequest naming it */
export async function packument(name: string) {
	const res = await get(`${REGISTRY}/${name.replace("/", "%2f")}`);
	if (res.status === 404) throw new BadRequestError(`${name} is not on the npm registry`);
	if (!res.ok) throw new BadRequestError(`The registry answered ${res.status} for ${name}`);
	return (await res.json()) as Packument;
}

/** why `version` may not be installed under the project's release age rule, or undefined */
export function releaseAgeProblem(
	doc: Packument,
	name: string,
	version: string,
	projectId: string,
) {
	const days = minReleaseAgeDays(projectId);
	const published = Date.parse(doc.time?.[version] ?? "");
	if (days > 0 && !(published <= Date.now() - days * 86_400_000))
		return Number.isNaN(published)
			? `The registry does not say when ${name}@${version} was published, so this project's ${days}-day release age rule cannot be checked`
			: `${name}@${version} was published less than ${days} days ago. This project waits ${days} days before installing a release (Packages settings).`;
	return undefined;
}

async function registryEntry(name: string, version: string, projectId: string) {
	const doc = await packument(name);
	const dist = doc.versions?.[version]?.dist;
	if (!dist?.tarball || !dist.integrity)
		throw new BadRequestError(`${name}@${version} does not exist on the registry`);
	const tooYoung = releaseAgeProblem(doc, name, version, projectId);
	if (tooYoung) throw new BadRequestError(tooYoung);
	return { tarball: dist.tarball, integrity: dist.integrity };
}

/** fetches, checks and registers `name@version`, nothing else */
export async function registerNpmVersion(projectId: string, name: string, version: string) {
	const entry = await registryEntry(name, version, projectId);
	const tarball = await get(entry.tarball);
	if (!tarball.ok)
		throw new BadRequestError(`The registry answered ${tarball.status} for the tarball`);
	const bytes = await readCapped(tarball);
	verifyIntegrity(bytes, entry.integrity);

	const valid = validatePlugin(await untar(bytes));
	if (valid.version !== version)
		throw new BadRequestError(
			`${name}@${version} holds a package.json saying version ${valid.version}; refusing it`,
		);
	return {
		manifest: valid.manifest,
		register: () =>
			registerSourced(projectId, {
				manifest: valid.manifest,
				version: valid.version,
				source: "npm",
				location: `${name}@${version}`,
				integrity: entry.integrity,
			}),
	};
}

const CDN = "https://cdn.jsdelivr.net/npm";

/** `fluxify.json` of `name@version` on jsDelivr, unparsed; refused when the package has none */
export async function cdnManifest(name: string, version: string): Promise<unknown> {
	const res = await get(`${CDN}/${name}@${version}/fluxify.json`);
	if (res.status === 404)
		throw new BadRequestError(`${name}@${version} is not a Fluxify plugin: it has no fluxify.json`);
	if (!res.ok) throw new BadRequestError(`jsDelivr answered ${res.status} for ${name}@${version}`);
	return res.json().catch(() => null);
}
