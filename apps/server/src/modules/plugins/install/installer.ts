import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { logger } from "@fluxify/common";
import { type PluginInstallStatus, pluginStatusKey } from "@fluxify/common/orchestrator";
import type { PluginArtifact } from "../../compiler/artifacts";
import { frozenInstall, smokeTest } from "../../packages/bunInstall";
import { depsRoot, pluginDir } from "../../packages/depsDir";
import { declaredPackages } from "../../packages/resolver";
import {
	type PluginIntegrationRef,
	pluginIntegrationRefs,
} from "../../requestRouter/pluginIntegrations";
import { type PluginBlockRef, pluginBlockRefs } from "../../requestRouter/pluginLoader";
import { type PluginTriggerRef, pluginTriggerRefs } from "../../requestRouter/pluginTriggers";
import type { PluginFiles } from "../sources/tar";
import { fetchPluginFiles } from "./source";

/**
 * Supervisor-side half of #859: turns an approved plugin's artifact into an
 * installed directory the execution process can import from, and tells the
 * supervisor where its blocks are.
 *
 * Each plugin installs into its own `pluginDir(...)`, written aside and renamed
 * into place so no reader meets a half-written one. The dependencies come from
 * the plugin's own frozen lockfile, through the same `bun install` the
 * project's packages use. Per plugin the work is serialized and latest-wins; a
 * plugin that fails to install reports an error and changes nothing else.
 */

const MARKER = ".fluxify-plugin";

export type PluginChange = {
	projectId: string;
	/** block types now provided by an installed plugin; none when one was removed */
	types: string[];
	/** the plugin stopped being served here: its loaded code must go (#860) */
	removed?: boolean;
};

export interface PluginInstallerOptions {
	root?: string;
	/** every change to what this node reports, for the heartbeat */
	onStatus(statuses: Record<string, PluginInstallStatus>): void;
	/**
	 * `refs()` changed. Resolves once the execution process has them, which for
	 * a new version is once the old process is gone and nothing uses the old
	 * directory any more.
	 */
	onRefsChanged(change: PluginChange): Promise<void>;
	/**
	 * Whether either environment still publishes the plugin. A development and a
	 * production worker can share one root (the Kit), so a removed plugin's
	 * directories are pruned only when neither does. Unset, they are kept.
	 */
	publishedAnywhere?(projectId: string, name: string): Promise<boolean>;
}

/** the directory name of a version: the integrity keeps a re-upload of the same version apart */
const slotOf = ({ version, integrity }: Pick<PluginArtifact, "version" | "integrity">) =>
	`${version}+${createHash("sha256").update(integrity).digest("hex").slice(0, 8)}`;

export function createPluginInstaller(options: PluginInstallerOptions) {
	const root = options.root ?? depsRoot();
	const statuses: Record<string, PluginInstallStatus> = {};
	/** installed and serving, by status key */
	const installed = new Map<string, { artifact: PluginArtifact; slot: string; dir: string }>();
	const queued = new Map<
		string,
		{ projectId: string; name: string; artifact: PluginArtifact | null }
	>();
	const running = new Map<string, Promise<void>>();

	function report(projectId: string, name: string, status: PluginInstallStatus | null) {
		const key = pluginStatusKey(projectId, name);
		if (status) statuses[key] = status;
		else delete statuses[key];
		options.onStatus({ ...statuses });
	}

	const refs = (): PluginBlockRef[] =>
		[...installed.values()].flatMap(({ artifact, slot, dir }) =>
			pluginBlockRefs({ ...artifact, version: slot }, dir),
		);
	const integrationRefs = (): PluginIntegrationRef[] =>
		[...installed.values()].flatMap(({ artifact, slot, dir }) =>
			pluginIntegrationRefs({ ...artifact, version: slot }, dir),
		);
	const triggerRefs = (): PluginTriggerRef[] =>
		[...installed.values()].flatMap(({ artifact, slot, dir }) =>
			pluginTriggerRefs({ ...artifact, version: slot }, dir),
		);
	/** every kind of ref, to tell whether an install changed what the child must load */
	const snapshot = () => JSON.stringify([refs(), integrationRefs(), triggerRefs()]);

	async function drain(key: string) {
		for (let job = queued.get(key); job; job = queued.get(key)) {
			queued.delete(key);
			const { projectId, name, artifact } = job;
			await (artifact ? install(artifact) : uninstall(projectId, name)).catch((error) => {
				const message = (error as Error).message ?? String(error);
				logger.error(`plugin ${name} for ${projectId}: ${message}`, "WORKER.plugins");
				if (artifact)
					report(projectId, name, {
						version: artifact.version,
						integrity: artifact.integrity,
						state: "error",
						error: message,
					});
			});
		}
		running.delete(key);
	}

	async function install(artifact: PluginArtifact) {
		const { projectId, name, version, integrity } = artifact;
		const key = pluginStatusKey(projectId, name);
		const slot = slotOf(artifact);
		const dir = pluginDir(projectId, name, slot, root);
		const before = snapshot();
		let failedImports: PluginInstallStatus["failedImports"];

		report(projectId, name, { version, integrity, state: "installing" });
		// already on disk (a restart, a re-publish, or the other environment's worker on a shared volume)
		if (
			(await Bun.file(join(dir, MARKER))
				.text()
				.catch(() => "")) !== integrity
		)
			failedImports = await materialize(artifact, dir);

		installed.set(key, { artifact, slot, dir });
		const types = Object.keys(artifact.blocks);
		if (snapshot() !== before) await options.onRefsChanged({ projectId, types });
		await removeOtherVersions(projectId, name, slot);
		logger.info(`plugin ${name}@${version} for ${projectId} installed`, "WORKER.plugins");
		report(projectId, name, {
			version,
			integrity,
			state: "ready",
			...(failedImports?.length ? { failedImports } : {}),
		});
	}

	/**
	 * Stops serving the plugin. Once the child that loaded it is replaced, its
	 * directories go, unless another environment on a shared root still has it.
	 */
	async function uninstall(projectId: string, name: string) {
		const key = pluginStatusKey(projectId, name);
		const was = installed.get(key);
		installed.delete(key);
		if (was) {
			await options.onRefsChanged({ projectId, types: [], removed: true });
			if (options.publishedAnywhere && !(await options.publishedAnywhere(projectId, name)))
				await rm(dirname(was.dir), { recursive: true, force: true });
		}
		report(projectId, name, null);
	}

	/** fetches, verifies, installs dependencies aside, and renames into `dir` */
	async function materialize(artifact: PluginArtifact, dir: string) {
		const staging = `${dir}.tmp-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
		await rm(staging, { recursive: true, force: true });
		try {
			const files = await fetchPluginFiles(artifact);
			await writeFiles(staging, files);
			// bun deletes an empty lockfile, so a frozen install of nothing would fail
			const packages = Object.keys(
				declaredPackages(new TextDecoder().decode(files.get("package.json"))),
			);
			let failedImports: PluginInstallStatus["failedImports"] = [];
			if (packages.length) {
				// peers are the worker's own @fluxify/sdk and zod (`hostPackages.ts`), never a second copy
				const error = await frozenInstall(staging, root, ["--omit=peer"]);
				if (error) throw new Error(`dependencies did not install: ${error}`);
				failedImports = await smokeTest(staging, packages);
			}
			await Bun.write(join(staging, MARKER), artifact.integrity);
			await moveIntoPlace(staging, dir, artifact.integrity);
			return failedImports;
		} finally {
			await rm(staging, { recursive: true, force: true });
		}
	}

	/** another node on the same volume may have finished first; its directory is just as good */
	async function moveIntoPlace(staging: string, dir: string, integrity: string) {
		try {
			await rename(staging, dir);
		} catch (error) {
			if (
				(await Bun.file(join(dir, MARKER))
					.text()
					.catch(() => "")) !== integrity
			)
				throw error;
		}
	}

	/** superseded versions, once nothing runs them; another node's unfinished staging is left alone */
	async function removeOtherVersions(projectId: string, name: string, keep: string) {
		const base = dirname(pluginDir(projectId, name, keep, root));
		for (const entry of await readdir(base).catch(() => [])) {
			if (entry !== keep && !entry.includes(".tmp-"))
				await rm(join(base, entry), { recursive: true, force: true });
		}
	}

	return {
		/** queues the latest artifact for a plugin; null stops serving it */
		apply(projectId: string, name: string, artifact: PluginArtifact | null) {
			const key = pluginStatusKey(projectId, name);
			queued.set(key, { projectId, name, artifact });
			if (!running.has(key)) running.set(key, drain(key));
		},
		/** where every installed plugin's blocks are, for the supervisor's `pluginRefs` */
		refs,
		/** where every installed plugin's integration variants are (I6) */
		integrationRefs,
		/** where every installed plugin's trigger kinds are (T2) */
		triggerRefs,
		/** resolves once every queued install has finished, however it ended */
		async idle() {
			while (running.size) await Promise.all(running.values());
		},
	};
}

export type PluginInstaller = ReturnType<typeof createPluginInstaller>;

async function writeFiles(dir: string, files: PluginFiles) {
	const base = resolve(dir) + sep;
	await mkdir(dir, { recursive: true });
	for (const [path, bytes] of files) {
		const target = resolve(dir, path);
		// the sources refuse these already; this is the last line before the disk
		if (!target.startsWith(base)) throw new Error(`the plugin holds an unsafe path '${path}'`);
		await mkdir(dirname(target), { recursive: true });
		await Bun.write(target, bytes);
	}
}

/** the stored artifacts that call any of `types`, which need applying again once those blocks exist */
export function artifactsCalling<T extends { value: unknown }>(
	entries: Iterable<T>,
	projectId: string,
	types: string[],
) {
	const wanted = new Set(types);
	return [...entries].filter(({ value }) => {
		const artifact = value as { projectId?: string; pluginBlocks?: string[] } | null;
		return artifact?.projectId === projectId && artifact.pluginBlocks?.some((t) => wanted.has(t));
	});
}
