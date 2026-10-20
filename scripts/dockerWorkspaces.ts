// Every Dockerfile installs with --frozen-lockfile, which needs each workspace's
// package.json in its deps stage; the worker and the orchestrator also copy
// only the packages the server imports. A workspace added to one and not the
// other builds fine locally and breaks the image (#877 added packages/sdk).

export type DockerWorkspace = { dir: string; name: string; runtime: string[] };

/** the lines of the stage named `stage` (`FROM ... AS <stage>` up to the next FROM) */
function stageOf(dockerfile: string, stage: string): string | undefined {
	const lines = dockerfile.split("\n");
	const start = lines.findIndex((l) => new RegExp(`^FROM\\s.*\\sAS\\s+${stage}\\s*$`, "i").test(l));
	if (start < 0) return undefined;
	const end = lines.findIndex((l, i) => i > start && /^FROM\s/i.test(l));
	return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** a `COPY <source> ...` line */
const copies = (stage: string, source: string) =>
	stage.split("\n").some((l) => l.split(/\s+/).slice(0, 2).join(" ") === `COPY ${source}`);

/** @fluxify/* runtime closure of `root`: dependencies and peers, not devDependencies */
function runtimeClosure(root: string, workspaces: DockerWorkspace[]) {
	const byName = new Map(workspaces.map((w) => [w.name, w]));
	const seen = new Set<string>();
	const visit = (name: string) => {
		if (seen.has(name) || !byName.has(name)) return;
		seen.add(name);
		for (const dep of byName.get(name)!.runtime) visit(dep);
	};
	visit(root);
	return [...seen].map((n) => byName.get(n)!);
}

/** `dockerfiles` maps a path to its text. Returns the problems found. */
export function checkDockerfiles(
	workspaces: DockerWorkspace[],
	dockerfiles: Record<string, string>,
	serverName = "@fluxify/server",
): string[] {
	const errors: string[] = [];
	const imported = runtimeClosure(serverName, workspaces);
	for (const [file, text] of Object.entries(dockerfiles)) {
		const deps = stageOf(text, "deps");
		if (!deps) {
			errors.push(`${file}: no deps stage (FROM ... AS deps)`);
			continue;
		}
		for (const w of workspaces)
			if (!copies(deps, `${w.dir}/package.json`))
				errors.push(`${file}: deps stage does not COPY ${w.dir}/package.json`);

		const build = stageOf(text, "build");
		// a build stage that copies the whole repo has nothing to forget
		if (!build || /^COPY\s+\.\s+\.\s*$/m.test(build)) continue;
		for (const w of imported)
			if (!copies(build, w.dir))
				errors.push(`${file}: build stage does not COPY ${w.dir}, which ${serverName} depends on`);
	}
	return errors;
}
