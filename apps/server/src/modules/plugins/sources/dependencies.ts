import { type FluxifyManifest, pluginDependencySchema } from "@fluxify/sdk/blocks";
import { z } from "zod";
import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";
import { listPluginRows } from "../repository";
import { DependencyError, type InstallStep, type Registry, resolveDependencies } from "../resolve";
import { assertCreator, type Caller, getPlugin } from "../service";
import {
	cdnManifest,
	type Packument,
	packument,
	parseSpec,
	registerNpmVersion,
	releaseAgeProblem,
} from "./npm";

/**
 * Adding a plugin together with the plugins it depends on (#899). The graph is
 * resolved against the project and the npm registry before anything is
 * registered, so a cycle, a conflict or a missing version changes nothing.
 * Dependencies register first, each pending like any new version; the plugin
 * that needs them cannot be approved until they are.
 */

/** the part of a `fluxify.json` resolution reads */
const resolvable = z.object({
	name: z.string(),
	dependencies: z.array(pluginDependencySchema).optional(),
});

/** the registry as the resolver sees it: versions old enough for the project, manifests from jsDelivr */
function npmRegistry(projectId: string): Registry {
	const docs = new Map<string, Promise<Packument>>();
	const doc = (name: string) => docs.get(name) ?? docs.set(name, packument(name)).get(name)!;
	return {
		async versions(name) {
			const d = await doc(name).catch((error) => {
				if (error instanceof BadRequestError) return {} as Packument;
				throw error;
			});
			return Object.keys(d.versions ?? {}).filter(
				(v) =>
					/^\d+\.\d+\.\d+$/.test(v) &&
					d.versions?.[v]?.dist?.integrity &&
					!releaseAgeProblem(d, name, v, projectId),
			);
		},
		async manifest(name, version) {
			const parsed = resolvable.safeParse(await cdnManifest(name, version));
			if (!parsed.success)
				throw new BadRequestError(`${name}@${version} has an unreadable fluxify.json`);
			return parsed.data;
		},
	};
}

/** each dependency of `manifest` to install or upgrade, dependencies first; a refusal is a 409 */
export async function planDependencies(
	projectId: string,
	manifest: Pick<FluxifyManifest, "name" | "dependencies">,
): Promise<InstallStep[]> {
	const installed = (await listPluginRows(projectId)).map((r) => ({
		plugin: r.name,
		version: r.version,
		dependencies: r.manifest.dependencies ?? [],
	}));
	try {
		return await resolveDependencies(
			{ plugin: manifest.name, dependencies: manifest.dependencies ?? [] },
			installed,
			npmRegistry(projectId),
		);
	} catch (error) {
		if (error instanceof DependencyError)
			throw error.kind === "missing"
				? new BadRequestError(error.message)
				: new ConflictError(error.message);
		throw error;
	}
}

/** registers each step in order; every one is downloaded and checked like a plugin added by hand */
export async function installDependencies(projectId: string, steps: InstallStep[]) {
	for (const step of steps)
		await (await registerNpmVersion(projectId, step.name, step.version)).register();
}

/** what adding `spec` would install: the plugin, and the dependencies it brings */
export async function resolveNpmPlugin(projectId: string, spec: string, caller: Caller) {
	assertCreator(caller, projectId);
	const { name, version } = parseSpec(spec);
	const manifest = resolvable.safeParse(await cdnManifest(name, version));
	if (!manifest.success)
		throw new BadRequestError(`${name}@${version} has an unreadable fluxify.json`);
	return {
		name,
		plugin: manifest.data.name,
		version,
		dependencies: await planDependencies(projectId, manifest.data),
	};
}

/** adds npm `spec`, after the dependencies the project lacks or holds out of range */
export async function addNpmPlugin(projectId: string, spec: string, caller: Caller) {
	assertCreator(caller, projectId);
	const { name, version } = parseSpec(spec);
	await cdnManifest(name, version);
	const fetched = await registerNpmVersion(projectId, name, version);
	const steps = await planDependencies(projectId, fetched.manifest);
	await installDependencies(projectId, steps);
	return fetched.register();
}

/** an installed plugin's missing dependencies (one added by upload, url or a folder): what installing them would do */
export async function planPluginDependencies(projectId: string, name: string) {
	const row = await getPlugin(projectId, name);
	return { dependencies: await planDependencies(projectId, row.manifest) };
}

export async function installPluginDependencies(projectId: string, name: string, caller: Caller) {
	assertCreator(caller, projectId);
	const { dependencies } = await planPluginDependencies(projectId, name);
	await installDependencies(projectId, dependencies);
	return { dependencies };
}
