import { join } from "node:path";
import { executionRuntimeEnvironment } from "../requestRouter/executionEnvironment";

/**
 * Running `bun install` for a directory, shared by project packages (#477) and
 * plugin dependencies (#859): both install a frozen lockfile and then load
 * every top-level package once before anything depends on it.
 */

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const SMOKE_TIMEOUT_MS = 60_000;

/**
 * `bun install --frozen-lockfile --production` in `dir`. Resolves to why it
 * failed, or undefined. `cacheRoot` holds bun's shared download cache.
 */
export async function frozenInstall(dir: string, cacheRoot: string) {
	const installed = await run(
		["install", "--frozen-lockfile", "--production"],
		dir,
		INSTALL_TIMEOUT_MS,
		{
			...process.env,
			BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR ?? join(cacheRoot, ".cache"),
		},
	);
	if (installed.exitCode === 0) return;
	return installed.timedOut ? "install timed out" : lastError(installed.output);
}

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
export async function smokeTest(dir: string, names: string[]) {
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
