import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadRequestError } from "../../errors/badRequestError";

/**
 * Resolves a project's npm packages to a lockfile, on the admin (#477).
 *
 * `--lockfile-only` resolves and writes `bun.lock` without populating
 * node_modules or running a single lifecycle script, so nothing a package
 * ships executes here. Workers later install from exactly this lockfile.
 */

export type Manifest = { packageJson: string; lockfile: string };

export type ResolveChange =
	| { add: { name: string; version?: string }[]; trust?: boolean }
	| { remove: string[] };

const RESOLVE_TIMEOUT_MS = 60_000;
const DAY_SECONDS = 86_400;

// npm's own rules, minus legacy uppercase names. Anchored and dash-free at the
// start, so nothing here can be read by bun as a flag.
const NAME_RE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION_RE = /^[0-9a-zA-Z^~<>=.*|+ -]+$/;

export const EMPTY_PACKAGE_JSON = `${JSON.stringify({ name: "fluxify-project", private: true }, null, 2)}\n`;

export function assertPackageName(name: string) {
	if (!NAME_RE.test(name) || name.length > 214) {
		throw new BadRequestError(`"${name}" is not a valid npm package name`);
	}
}

function specOf({ name, version }: { name: string; version?: string }) {
	assertPackageName(name);
	if (version === undefined || version === "") return name;
	if (!VERSION_RE.test(version) || version.startsWith("-")) {
		throw new BadRequestError(`"${version}" is not a valid version for ${name}`);
	}
	return `${name}@${version}`;
}

function commandFor(change: ResolveChange, minReleaseAgeDays: number) {
	if ("remove" in change) {
		for (const name of change.remove) assertPackageName(name);
		return ["remove", ...change.remove, "--lockfile-only"];
	}
	const args = ["add", ...change.add.map(specOf), "--lockfile-only"];
	if (minReleaseAgeDays > 0) args.push(`--minimum-release-age=${minReleaseAgeDays * DAY_SECONDS}`);
	// lists the packages in trustedDependencies; slim workers run their scripts
	if (change.trust) args.push("--trust");
	return args;
}

export async function resolveDependencies(
	current: Manifest | null,
	change: ResolveChange,
	minReleaseAgeDays: number,
): Promise<Manifest> {
	const dir = await mkdtemp(join(tmpdir(), "fluxify-deps-"));
	try {
		await Bun.write(join(dir, "package.json"), current?.packageJson ?? EMPTY_PACKAGE_JSON);
		if (current?.lockfile) await Bun.write(join(dir, "bun.lock"), current.lockfile);

		const child = Bun.spawn([process.execPath, ...commandFor(change, minReleaseAgeDays)], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
			timeout: RESOLVE_TIMEOUT_MS,
			env: { ...process.env, BUN_BE_BUN: "1" },
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (child.signalCode) {
			throw new BadRequestError("Resolving packages timed out — is the npm registry reachable?");
		}
		if (exitCode !== 0) throw new BadRequestError(resolveError(`${stderr}\n${stdout}`));

		return {
			packageJson: await Bun.file(join(dir, "package.json")).text(),
			// bun deletes the lockfile once the last package is removed
			lockfile: await Bun.file(join(dir, "bun.lock"))
				.text()
				.catch(() => ""),
		};
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** bun's own `error:` lines are already the message a user needs */
function resolveError(output: string) {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("error:"))
		.map((line) => line.slice("error:".length).trim());
	return lines.length ? lines.join("; ") : "Could not resolve packages";
}

/** the top-level packages a manifest declares */
export function declaredPackages(packageJson: string): Record<string, string> {
	const parsed = JSON.parse(packageJson) as { dependencies?: Record<string, string> };
	return parsed.dependencies ?? {};
}

/** the version the lockfile pinned a top-level package to */
export function lockedVersion(lockfile: string, name: string): string | null {
	const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
	const match = lockfile.match(new RegExp(`"${escaped}": \\["${escaped}@([^"]+)"`));
	return match?.[1] ?? null;
}
