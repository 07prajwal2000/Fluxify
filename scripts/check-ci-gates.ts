// Fails when a CI test gate drifts from the monorepo's own @fluxify/*
// dependencies (#709), or a test file imports a @fluxify/* package its
// package.json does not declare. Bun resolves undeclared imports from the root
// node_modules, so those pass locally and only break in CI.

import { readFileSync } from "node:fs";
import { Glob } from "bun";

const WORKFLOW = ".github/workflows/ci.yml";

// filter name -> workspace dir -> the test jobs that read it.
const GATES: Record<string, { dir: string; jobs: string[] }> = {
	lib: { dir: "packages/lib", jobs: ["test-packages-lib"] },
	blocks: { dir: "packages/blocks", jobs: ["test-packages-blocks"] },
	adapters: { dir: "packages/adapters", jobs: ["test-packages-adapters"] },
	server: {
		dir: "apps/server",
		jobs: ["test-apps-server-unit", "test-apps-server-integration"],
	},
	"ai-gateway": { dir: "apps/ai-gateway", jobs: ["test-apps-ai-gateway"] },
	e2e: { dir: "testing/e2e", jobs: ["test-e2e-graphs"] },
	portal: { dir: "apps/portal", jobs: ["test-apps-portal"] },
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const errors: string[] = [];

// Workspace name -> { dir, deps }. Workspaces are `packages/*`, `apps/*` and
// `testing/e2e`, read from the root package.json.
const workspaces = new Map<string, { dir: string; deps: string[] }>();
for (const pattern of readJson("package.json").workspaces as string[]) {
	for (const file of new Glob(`${pattern}/package.json`).scanSync(".")) {
		const dir = file.replaceAll("\\", "/").replace(/\/package\.json$/, "");
		const pkg = readJson(file);
		const all = { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
		workspaces.set(pkg.name, {
			dir,
			deps: Object.keys(all).filter((d) => d.startsWith("@fluxify/")),
		});
	}
}
const byDir = new Map([...workspaces].map(([name, w]) => [w.dir, name]));

function closure(name: string, seen = new Set<string>()) {
	if (seen.has(name)) return seen;
	seen.add(name);
	for (const dep of workspaces.get(name)?.deps ?? []) closure(dep, seen);
	return seen;
}

// ---- 1. gates match the closure ----
const workflow = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8")) as any;
const detect = workflow.jobs["detect-changes"];
const filterText = detect.steps.find((s: any) => s.id === "filter").with.filters;
// paths-filter allows anchors, which parse into nested arrays: flatten them.
const filters = Bun.YAML.parse(filterText) as Record<string, any[]>;

for (const [filter, { dir, jobs }] of Object.entries(GATES)) {
	const root = byDir.get(dir);
	if (!root) {
		errors.push(`${filter}: no workspace at ${dir}`);
		continue;
	}
	const expected = new Set([...closure(root)].map((n) => `${workspaces.get(n)!.dir}/**`));
	expected.add(WORKFLOW);
	const actual = new Set((filters[filter] ?? []).flat(Infinity) as string[]);
	const missing = [...expected].filter((p) => !actual.has(p));
	const extra = [...actual].filter((p) => !expected.has(p));
	if (missing.length) errors.push(`filter "${filter}" is missing: ${missing.join(", ")}`);
	if (extra.length)
		errors.push(`filter "${filter}" has paths it does not depend on: ${extra.join(", ")}`);

	if (!String(detect.outputs[filter] ?? "").includes(`steps.filter.outputs.${filter} ==`)) {
		errors.push(`detect-changes has no output "${filter}" reading its filter`);
	}
	for (const job of jobs) {
		const gate = workflow.jobs[job]?.if;
		if (!String(gate).includes(`needs.detect-changes.outputs.${filter} ==`)) {
			errors.push(`job "${job}" is not gated on the "${filter}" filter`);
		}
	}
}
for (const filter of Object.keys(filters)) {
	if (!(filter in GATES))
		errors.push(`filter "${filter}" is not in GATES (scripts/check-ci-gates.ts)`);
}

// ---- 2. test files only import declared @fluxify/* packages ----
const IMPORT = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'](@fluxify\/[^/"']+)/g;
const TESTS = "**/*.{test,spec}.{ts,tsx}";
for (const [name, { dir, deps }] of workspaces) {
	// Everything under testing/e2e is test code, whatever the file is called.
	const pattern = dir === "testing/e2e" ? "**/*.{ts,tsx}" : TESTS;
	for (const file of new Glob(pattern).scanSync({ cwd: dir })) {
		if (file.includes("node_modules")) continue;
		const text = readFileSync(`${dir}/${file}`, "utf8");
		for (const [, imported] of text.matchAll(IMPORT)) {
			if (imported !== name && !deps.includes(imported)) {
				errors.push(`${dir}/${file} imports ${imported}, which ${name} does not declare`);
			}
		}
	}
}

if (errors.length) {
	console.error(`CI gate check failed:\n - ${[...new Set(errors)].join("\n - ")}`);
	process.exit(1);
}
console.log(`CI gates match the monorepo dependencies (${Object.keys(GATES).length} gates).`);
