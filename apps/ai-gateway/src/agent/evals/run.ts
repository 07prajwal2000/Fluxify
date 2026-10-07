import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { ModelMessage } from "ai";
import { printRun, startAgent } from "../cli";

/**
 * Runs every task in tasks.md and saves each conversation (the printed log and
 * the raw messages). Grading is by hand, with each task's Check line.
 *   bun run agent:evals --project <id> [--only 1,6] [--out <dir>]
 */

export type Task = { n: string; title: string; setup?: string; prompt: string };

export function parseTasks(md: string): Task[] {
	return md
		.split(/^## /m)
		.slice(1)
		.map((section) => {
			const [head, ...lines] = section.split("\n");
			const [, n, title] = head.match(/^(\d+)\.\s*(.*)$/) ?? [];
			const body = lines.filter((l) => !l.startsWith("Check:"));
			const setup = body.find((l) => l.startsWith("Setup:"));
			const prompt = body
				.filter((l) => l !== setup)
				.join("\n")
				.trim();
			return { n, title, setup: setup?.slice("Setup:".length).trim(), prompt };
		})
		.filter((t) => t.n);
}

async function runOne(prompt: string, projectId: string, file: string) {
	let log = `# ${prompt}\n\n`;
	const history: ModelMessage[] = [{ role: "user", content: prompt }];
	await printRun(startAgent(projectId, { history }), {
		write: (s) => {
			log += s;
			process.stdout.write(s);
		},
	});
	writeFileSync(`${file}.log`, log);
	writeFileSync(`${file}.json`, JSON.stringify(history.slice(1), null, 2));
}

if (import.meta.main) {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: { project: { type: "string" }, only: { type: "string" }, out: { type: "string" } },
	});
	if (!values.project) {
		console.error("Usage: bun run agent:evals --project <projectId> [--only 1,6] [--out <dir>]");
		process.exit(1);
	}
	const model = `${process.env.AGENT_PROVIDER}-${process.env.AGENT_MODEL}`.replace(/[^\w.-]/g, "_");
	const out = values.out ?? path.join(import.meta.dirname, "out", model);
	mkdirSync(out, { recursive: true });
	const only = values.only?.split(",");
	const tasks = parseTasks(readFileSync(path.join(import.meta.dirname, "tasks.md"), "utf8"));
	for (const task of tasks.filter((t) => !only || only.includes(t.n))) {
		console.log(`\n=== ${task.n}. ${task.title}`);
		try {
			if (task.setup) await runOne(task.setup, values.project, path.join(out, `${task.n}-setup`));
			await runOne(task.prompt, values.project, path.join(out, task.n));
		} catch (e) {
			console.error(`task ${task.n} failed to run:`, e);
		}
	}
	console.log(`\nSaved to ${out}`);
}
