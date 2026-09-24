import { mkdir, readdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@fluxify/common";
import type { DepsInstallStatus } from "@fluxify/common/orchestrator";
import type { DepsArtifact } from "../compiler/artifacts";
import { executionRuntimeEnvironment } from "../requestRouter/executionEnvironment";
import { currentLink, depsRoot, projectDepsDir, versionDir } from "./depsDir";
import { declaredPackages } from "./resolver";

/**
 * Supervisor-side half of #477: turns a project's `deps` artifact into an
 * installed directory the execution process can import from.
 *
 * Installs run from the admin's lockfile with `--frozen-lockfile`, into a fresh
 * `v<N>` directory, and only then is `current` repointed — the running child
 * keeps the old version until the caller swaps it. Per project the work is
 * serialized and latest-wins, so a burst of edits installs once.
 */

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const SMOKE_TIMEOUT_MS = 60_000;

export interface DepsInstallerOptions {
	root?: string;
	/** every change to what this node reports, for the heartbeat */
	onStatus(statuses: Record<string, DepsInstallStatus>): void;
	/** `current` moved; resolves once nothing uses the old version any more */
	onInstalled(projectId: string): Promise<void>;
}

export function createDepsInstaller(options: DepsInstallerOptions) {
	const root = options.root ?? depsRoot();
	const statuses: Record<string, DepsInstallStatus> = {};
	const queued = new Map<string, DepsArtifact | null>();
	const running = new Map<string, Promise<void>>();

	function report(projectId: string, status: DepsInstallStatus | null) {
		if (status) statuses[projectId] = status;
		else delete statuses[projectId];
		options.onStatus({ ...statuses });
	}

	async function drain(projectId: string) {
		while (queued.has(projectId)) {
			const artifact = queued.get(projectId) ?? null;
			queued.delete(projectId);
			await (artifact ? install(artifact) : uninstall(projectId)).catch((error) => {
				logger.error(`packages for ${projectId}: ${String(error)}`, "WORKER.packages");
				if (artifact) {
					report(projectId, { version: artifact.version, state: "failed", error: String(error) });
				}
			});
		}
		running.delete(projectId);
	}

	async function install(artifact: DepsArtifact) {
		const { projectId, version } = artifact;
		const dir = versionDir(projectId, version, root);
		// a restart on a persistent volume: already installed, nothing to swap
		if ((await installedVersion(projectId)) === version) {
			return report(projectId, { version, state: "ready" });
		}
		report(projectId, { version, state: "installing" });
		await rm(dir, { recursive: true, force: true });
		await mkdir(dir, { recursive: true });
		await Bun.write(join(dir, "package.json"), artifact.packageJson);
		await Bun.write(join(dir, "bun.lock"), artifact.lockfile);

		const installed = await run(
			["install", "--frozen-lockfile", "--production"],
			dir,
			INSTALL_TIMEOUT_MS,
			{
				...process.env,
				BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR ?? join(root, ".cache"),
			},
		);
		if (installed.exitCode !== 0) {
			await rm(dir, { recursive: true, force: true });
			const error = installed.timedOut ? "install timed out" : lastError(installed.output);
			return report(projectId, { version, state: "failed", error });
		}

		const failedImports = await smokeTest(dir, Object.keys(declaredPackages(artifact.packageJson)));
		await pointCurrent(projectId, dir);
		logger.info(`packages for ${projectId} installed at v${version}`, "WORKER.packages");
		await options.onInstalled(projectId);
		await removeOtherVersions(projectId, `v${version}`);
		report(projectId, {
			version,
			state: "ready",
			...(failedImports.length ? { failedImports } : {}),
		});
	}

	async function uninstall(projectId: string) {
		await rm(currentLink(projectId, root), { force: true });
		await options.onInstalled(projectId);
		await rm(projectDepsDir(projectId, root), { recursive: true, force: true });
		report(projectId, null);
	}

	/** a symlink written aside and renamed over `current`, so no reader sees neither */
	async function pointCurrent(projectId: string, dir: string) {
		const link = currentLink(projectId, root);
		// Windows (local dev) cannot rename over a junction; the gap is harmless
		// there, since the running child already resolved its imports.
		if (process.platform === "win32") {
			await rm(link, { force: true });
			return symlink(dir, link, "junction");
		}
		const next = `${link}.next`;
		await rm(next, { force: true });
		await symlink(dir, next, "dir");
		await rename(next, link);
	}

	async function removeOtherVersions(projectId: string, keep: string) {
		const base = projectDepsDir(projectId, root);
		for (const entry of await readdir(base)) {
			if (/^v\d+$/.test(entry) && entry !== keep) {
				await rm(join(base, entry), { recursive: true, force: true });
			}
		}
	}

	/** the version `current` points at, if any */
	async function installedVersion(projectId: string) {
		const target = await readlink(currentLink(projectId, root)).catch(() => null);
		const match = target?.match(/v(\d+)[\\/]?$/);
		return match ? Number(match[1]) : null;
	}

	return {
		/** queues the latest artifact for a project; null removes its packages */
		apply(projectId: string, artifact: DepsArtifact | null) {
			queued.set(projectId, artifact);
			if (!running.has(projectId)) running.set(projectId, drain(projectId));
		},
		/** resolves once every queued install has finished, however it ended */
		async idle() {
			while (running.size) await Promise.all(running.values());
		},
	};
}

export type DepsInstaller = ReturnType<typeof createDepsInstaller>;

async function run(args: string[], cwd: string, timeout: number, env: NodeJS.ProcessEnv) {
	const child = Bun.spawn([process.execPath, ...args], {
		cwd,
		env: { ...env, BUN_BE_BUN: "1" },
		stdout: "pipe",
		stderr: "pipe",
		timeout,
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, output: `${stderr}\n${stdout}`, timedOut: Boolean(child.signalCode) };
}

function lastError(output: string) {
	const errors = output.split("\n").filter((line) => line.trim().startsWith("error:"));
	return (errors.at(-1) ?? output.trim().split("\n").at(-1) ?? "install failed").trim();
}

/**
 * Loads every top-level package once, in a throwaway process with the same
 * stripped environment user code gets: a package's top-level code runs here,
 * and it must not see this process's NATS credentials.
 */
async function smokeTest(dir: string, names: string[]) {
	if (!names.length) return [];
	const script = `
const out = [];
for (const name of ${JSON.stringify(names)}) {
	try { await import(Bun.resolveSync(name, ${JSON.stringify(`${dir}/`)})); }
	catch (e) { out.push({ name, error: String(e?.message ?? e).split("\\n")[0] }); }
}
console.log(JSON.stringify(out));
process.exit(0);`;
	const result = await run(["-e", script], dir, SMOKE_TIMEOUT_MS, executionRuntimeEnvironment());
	try {
		const lines = result.output.trim().split("\n");
		return JSON.parse(lines.at(-1) ?? "[]") as { name: string; error: string }[];
	} catch {
		return names.map((name) => ({ name, error: "smoke test did not finish" }));
	}
}
