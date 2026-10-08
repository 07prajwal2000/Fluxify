import { appendFileSync } from "node:fs";
import type { CheckResult } from "./checks";

export type Row = {
	id: string;
	checks: (CheckResult & { name: string })[];
	/** 0..1, or why there is no score */
	judge: number | "skipped" | "error";
	steps: number;
	tokensIn: number;
	tokensOut: number;
	ms: number;
	/** stop, step-limit, error, aborted, skipped: <why>, … */
	stop: string;
	error?: string;
};

const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Every check passed and nothing crashed. A skipped task is neither passed nor counted. */
export const passed = (r: Row) => !r.error && r.checks.length > 0 && r.checks.every((c) => c.pass);
const counted = (r: Row) => !r.stop.startsWith("skipped");

/** The run as a markdown table, then each failed check and error on its own line. */
export function table(rows: Row[]): string {
	const lines = [
		"| Task | Checks | Judge | Steps | Tokens in/out | Time | Stop |",
		"| --- | --- | --- | --- | --- | --- | --- |",
		...rows.map((r) => {
			const checks = counted(r)
				? `${passed(r) ? "PASS" : "FAIL"} ${r.checks.filter((c) => c.pass).length}/${r.checks.length}`
				: "-";
			const judge = typeof r.judge === "number" ? pct(r.judge) : r.judge;
			return `| ${r.id} | ${checks} | ${judge} | ${r.steps} | ${r.tokensIn}/${r.tokensOut} | ${secs(r.ms)} | ${r.stop} |`;
		}),
	];
	const notes = rows.flatMap((r) => [
		...(r.error ? [`- ${r.id}: error: ${r.error}`] : []),
		...r.checks.filter((c) => !c.pass).map((c) => `- ${r.id}: ${c.name}: ${c.message}`),
	]);
	return [...lines, ...(notes.length ? ["", ...notes] : [])].join("\n");
}

export const RESULTS_HEADER = `# Agent eval results

One row per full run of \`bun run agent:evals\` (all tasks, no \`--task\`). Passed counts tasks whose automatic checks all passed; skipped tasks are not counted. Judge is the average checklist score, or "skipped" with no judge model.

| Date | Model | Passed | Judge avg | Tokens | Time |
| --- | --- | --- | --- | --- | --- |
`;

/** The summary row a run appends to results.md. */
export function resultsRow(rows: Row[], model: string, date = new Date()): string {
	const run = rows.filter(counted);
	const scores = run.map((r) => r.judge).filter((j): j is number => typeof j === "number");
	const judge = scores.length ? pct(scores.reduce((a, b) => a + b, 0) / scores.length) : "skipped";
	const tokens = run.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0);
	const ms = rows.reduce((a, r) => a + r.ms, 0);
	const day = date.toISOString().slice(0, 10);
	return `| ${day} | ${model} | ${run.filter(passed).length}/${run.length} | ${judge} | ${tokens} | ${secs(ms)} |`;
}

export const appendResults = (file: string, row: string) => appendFileSync(file, `${row}\n`);
