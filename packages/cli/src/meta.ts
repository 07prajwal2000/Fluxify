import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type PluginMeta, pluginMetaSchema } from "@fluxify/sdk";
import { z } from "zod";
import { fail } from "./fail";

/** where a plugin describes itself */
export const INDEX = "src/index.ts";

/** `plugin({...})`, the default export of `src/index.ts`: the source of `fluxify.json`'s top */
export async function readMeta(root: string): Promise<PluginMeta> {
	const file = join(root, INDEX);
	if (!existsSync(file))
		return fail(
			`${INDEX} is missing: default-export plugin({ name, url }) from "@fluxify/sdk" in it`,
		);
	let def: unknown;
	try {
		def = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).default;
	} catch (error) {
		return fail(`${INDEX}: ${(error as Error).message.replaceAll("\n", " ")}`);
	}
	const parsed = pluginMetaSchema.safeParse(def);
	if (!parsed.success)
		return fail(
			`${INDEX} must default-export plugin({ name, url }): ${z.prettifyError(parsed.error).replaceAll("\n", " ")}`,
		);
	return parsed.data;
}

/**
 * `package.json`'s `fluxify: { name, url }` must say what `src/index.ts` says:
 * added when missing, a failure naming each difference when it drifted.
 */
export async function syncPackageJson(root: string, pkg: Record<string, any>, meta: PluginMeta) {
	const want = { name: meta.name, url: meta.url };
	if (pkg.fluxify === undefined) {
		const file = join(root, "package.json");
		const indent = (await Bun.file(file).text()).includes("\n\t") ? "\t" : 2;
		pkg.fluxify = want;
		await Bun.write(file, `${JSON.stringify(pkg, null, indent)}\n`);
		return;
	}
	const drift = (["name", "url"] as const)
		.filter((key) => pkg.fluxify?.[key] !== want[key])
		.map(
			(key) =>
				`package.json "fluxify.${key}" is ${JSON.stringify(pkg.fluxify?.[key])} but ${INDEX} says ${JSON.stringify(want[key])}: make them match`,
		);
	if (drift.length) fail(...drift);
}
