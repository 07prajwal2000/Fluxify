import { rmSync } from "node:fs";
import { join } from "node:path";
import { blockEntryPath, type FluxifyManifest } from "@fluxify/sdk/blocks";
import { fail, type Plugin } from "./plugin";

/** `<scope>-<name>-<version>.tgz` in the plugin root: package.json, bun.lock (when there is one), fluxify.json, dist/ and icons/ */
export async function pack(plugin: Plugin, manifest: FluxifyManifest): Promise<string> {
	const file = `${plugin.name.replace("/", "-")}-${plugin.version}.tgz`;
	const path = join(plugin.root, file);
	rmSync(path, { force: true });
	const proc = Bun.spawn(
		[process.execPath, "pm", "pack", "--filename", file, "--ignore-scripts", "--quiet"],
		{ cwd: plugin.root, stdout: "ignore", stderr: "pipe" },
	);
	const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
	if (code) fail(`bun pm pack failed: ${stderr.trim()}`);

	const entries = await new Bun.Archive(await Bun.file(path).bytes()).files();
	// bun never packs a lockfile, and the worker's install is frozen from this one
	const lock = Bun.file(join(plugin.root, "bun.lock"));
	if (await lock.exists()) entries.set("package/bun.lock", lock as unknown as File);
	const names = [...entries.keys()].map((n) => n.replace(/^package\//, ""));

	const stray = names.filter((n) => n.startsWith("src/") || n.split("/").includes("node_modules"));
	const missing = [
		"package.json",
		"fluxify.json",
		...Object.keys(manifest.blocks).map(blockEntryPath),
	].filter((n) => !names.includes(n));
	if (stray.length || missing.length) {
		rmSync(path, { force: true });
		fail(
			...(stray.length
				? [
						`the tarball would hold ${stray.slice(0, 3).join(", ")}${stray.length > 3 ? ", ..." : ""}: set "files" in package.json to ["dist", "icons", "fluxify.json"]`,
					]
				: []),
			...(missing.length ? [`the tarball is missing ${missing.join(", ")}`] : []),
		);
	}
	await Bun.write(
		path,
		await new Bun.Archive(Object.fromEntries(entries), { compress: "gzip" }).bytes(),
	);
	return file;
}
