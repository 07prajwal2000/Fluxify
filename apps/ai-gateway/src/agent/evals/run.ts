import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { LanguageModel, ModelMessage } from "ai";
import { ADMIN_API_URL } from "../../lib/env";
import { type AdminFetch, adminApi } from "../../mcp/adminApi";
import { MAX_STEPS, runAgent } from "../agent";
import { modelFromEnv } from "../model";
import { printRun } from "../progress";
import { type Limits, limitsFromEnv } from "../timeouts";
import { agentTools, mcpCall } from "../tools";
import { type Ctx, runCheck, type Task } from "./checks";
import { judge, judgeFromEnv, judgePrompt } from "./judge";
import { appendResults, type Row, resultsRow, table } from "./report";
import { tasks as ALL_TASKS } from "./tasks";

/**
 * Agent evals: each task gets a fresh project, its setup, an agent run, automatic checks,
 * an optional judge, then its project is removed.
 *   bun run agent:evals [--task health,echo] [--keep] [--no-judge]
 * --keep leaves each task's project for debugging. Ctrl+C stops the current task, cleans up
 * and prints the table so far; twice quits at once.
 * Env: the agent's own (AGENT_PROVIDER, AGENT_MODEL, AGENT_API_KEY, AGENT_BASE_URL, the
 * timeouts, FLUXIFY_PAT, FLUXIFY_URL; see cli.ts). The PAT's user must be a system admin
 * (it creates projects). Optional judge: AGENT_JUDGE_PROVIDER, AGENT_JUDGE_MODEL,
 * AGENT_JUDGE_API_KEY, AGENT_JUDGE_BASE_URL. Task "integration" needs EVAL_POSTGRES_URL,
 * a PostgreSQL URL the Fluxify server can reach; without it the task is skipped.
 * Output: apps/ai-gateway/logs/evals/<time>/ holds results.md (the table) and per task
 * <id>.log, <id>.json (messages) and <id>.judge.md (the judge's prompt, to judge by hand).
 * A full run (no --task, not stopped) appends one row to evals/results.md.
 */

export type Deps = {
	fetcher: AdminFetch;
	auth: Record<string, string>;
	model: Exclude<LanguageModel, string>;
	judgeModel?: LanguageModel;
	limits: Limits;
	env: Record<string, string | undefined>;
	outDir: string;
	keep?: boolean;
	write: (s: string) => void;
};

/**
 * Waits out the admin API's rate limit (429) instead of failing: setup, checks and
 * cleanup send bursts that the agent should not pay for.
 */
export const retryRateLimit =
	(fetcher: AdminFetch, tries = 6, waitMs = 1000): AdminFetch =>
	async (p, init) => {
		for (let i = 1; ; i++) {
			const res = await fetcher(p, init);
			if (res.status !== 429 || i >= tries) return res;
			const after = Number(res.headers.get("retry-after")) * 1000;
			await Bun.sleep(after > 0 && after < 30_000 ? after : waitMs * i);
		}
	};

/** Delete order matters: triggers before workflows, routes before middlewares before blocks. */
const CONTENTS = [
	["list_triggers", "delete_trigger", "triggerId"],
	["list_routes", "delete_route", "routeId"],
	["list_workflows", "delete_workflow", "workflowId"],
	["list_middlewares", "delete_middleware", "middlewareId"],
	["list_custom_blocks", "delete_custom_block", "customBlockId"],
	["list_integrations", "delete_integration", "integrationId"],
	["list_app_config", "delete_app_config", "appConfigId"],
] as const;

/**
 * The admin API has no project delete, so a task's project is emptied and hidden.
 * Returns what could not be removed.
 */
// ponytail: empty + hide; call a real DELETE /v1/projects/:id once the server has one
export async function removeProject(tool: Ctx["tool"], projectId: string) {
	const errors: string[] = [];
	for (const [list, del, key] of CONTENTS) {
		const failed = new Set<string>();
		for (let round = 0; round < 20; round++) {
			const out = await tool(list, { projectId }).catch((e: Error) => {
				errors.push(`${list}: ${e.message}`);
				return [];
			});
			const rows = (Array.isArray(out) ? out : out.items).filter(
				(r: any) => !failed.has(String(r.id)),
			);
			if (!rows.length) break;
			for (const r of rows) {
				await tool(del, { projectId, [key]: r.id }).catch((e: Error) => {
					failed.add(String(r.id));
					errors.push(`${del} ${r.id}: ${e.message}`);
				});
			}
		}
	}
	await tool("update_project", { projectId, hidden: true }).catch((e: Error) =>
		errors.push(`hide: ${e.message}`),
	);
	return errors;
}

/** A stream result's promise rejects when the run failed; that is already printed. */
const settle = <T, F>(p: PromiseLike<T>, fallback: F) => Promise.resolve(p).catch(() => fallback);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The tool calls in a conversation, in order. */
export const toolCalls = (history: ModelMessage[]) =>
	history.flatMap((m) =>
		m.role === "assistant" && Array.isArray(m.content)
			? m.content.flatMap((p) =>
					p.type === "tool-call" ? [{ name: p.toolName, input: p.input }] : [],
				)
			: [],
	);

/** One task end to end. Never throws: a crash is recorded on the row. */
export async function runTask(task: Task, deps: Deps, signal: AbortSignal): Promise<Row> {
	const t0 = Date.now();
	const row: Row = {
		id: task.id,
		checks: [],
		judge: "skipped",
		steps: 0,
		tokensIn: 0,
		tokensOut: 0,
		ms: 0,
		stop: "",
	};
	const missing = (task.needsEnv ?? []).filter((k) => !deps.env[k]);
	if (missing.length) return { ...row, stop: `skipped: needs ${missing.join(", ")}` };

	let log = "";
	const out = (s: string) => {
		log += s;
		deps.write(s);
	};
	const file = (ext: string) => path.join(deps.outDir, `${task.id}${ext}`);
	const tool = mcpCall(deps.fetcher, deps.auth);
	const api = adminApi(deps.fetcher, deps.auth, "creator");
	const history: ModelMessage[] = [];
	let projectId = "";
	try {
		const name = `eval-${task.id}-${Date.now().toString(36)}`;
		({ id: projectId } = await api.send("POST", "/v1/projects", {
			name,
			description: "Agent eval run. Safe to delete.",
		}));
		out(`project ${name} (${projectId})\n`);
		const ctx: Ctx = { projectId, tool, api, seed: {}, calls: [], env: deps.env };
		await task.setup?.(ctx);

		const { tools, active } = agentTools(deps.fetcher, deps.auth, projectId);
		for (const turn of [task.prompt].flat()) {
			if (signal.aborted) break;
			out(`\n> ${turn}\n`);
			history.push({ role: "user", content: turn });
			const result = runAgent({
				model: deps.model,
				tools,
				active,
				projectId,
				history,
				limits: deps.limits,
				abortSignal: signal,
			});
			await printRun(result, { write: out });
			const steps = await settle(result.steps, []);
			const usage = await settle(result.totalUsage, undefined);
			const finish = await settle(result.finishReason, "error");
			row.steps += steps.length;
			row.tokensIn += usage?.inputTokens ?? 0;
			row.tokensOut += usage?.outputTokens ?? 0;
			row.stop = finish === "tool-calls" && steps.length >= MAX_STEPS ? "step-limit" : finish;
		}
		if (signal.aborted) throw new Error("Stopped by user");

		ctx.calls = toolCalls(history);
		out("\nchecks:\n");
		for (const check of task.checks) {
			const r = { name: check.name, ...(await runCheck(check, ctx)) };
			row.checks.push(r);
			out(`  ${r.pass ? "PASS" : "FAIL"} ${r.name}: ${r.message}\n`);
		}

		const prompt = judgePrompt([task.prompt].flat().join("\n\nThen:\n"), task.judge, history);
		writeFileSync(file(".judge.md"), prompt);
		if (deps.judgeModel) {
			try {
				const v = await judge(deps.judgeModel, prompt, task.judge, signal);
				row.judge = v.score;
				out(
					`\njudge ${Math.round(v.score * 100)}%:\n${v.items.map((i) => `  ${i.pass ? "PASS" : "FAIL"} ${i.item}: ${i.reason}`).join("\n")}\n`,
				);
			} catch (e) {
				row.judge = "error";
				out(`\njudge error: ${message(e)}\n`);
			}
		}
	} catch (e) {
		row.error = message(e);
		row.stop = signal.aborted ? "aborted" : row.stop || "error";
		out(`\n[error] ${row.error}\n`);
	} finally {
		if (projectId && !deps.keep) {
			const errors = await removeProject(tool, projectId);
			if (errors.length) out(`\ncleanup left: ${errors.join("; ")}\n`);
		}
		row.ms = Date.now() - t0;
		writeFileSync(file(".log"), log);
		writeFileSync(file(".json"), JSON.stringify(history, null, 2));
	}
	return row;
}

/** Tasks one after another; `stopped()` ends the run between tasks. */
export async function runAll(
	list: Task[],
	deps: Deps,
	current: { ctrl?: AbortController; stopped?: boolean },
) {
	const rows: Row[] = [];
	mkdirSync(deps.outDir, { recursive: true });
	for (const task of list) {
		if (current.stopped) break;
		deps.write(`\n=== ${task.id}: ${task.title}\n`);
		current.ctrl = new AbortController();
		rows.push(await runTask(task, deps, current.ctrl.signal));
	}
	const report = table(rows);
	writeFileSync(path.join(deps.outDir, "results.md"), `${report}\n`);
	return { rows, report };
}

/** --task ids → tasks, in the suite's order; throws on an unknown id. */
export function pickTasks(ids: string | undefined, all = ALL_TASKS) {
	if (!ids) return all;
	const want = ids.split(",").map((s) => s.trim());
	const unknown = want.filter((id) => !all.some((t) => t.id === id));
	if (unknown.length)
		throw new Error(
			`Unknown task(s): ${unknown.join(", ")}. Known: ${all.map((t) => t.id).join(", ")}`,
		);
	return all.filter((t) => want.includes(t.id));
}

if (import.meta.main) {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			task: { type: "string" },
			keep: { type: "boolean" },
			"no-judge": { type: "boolean" },
		},
	});
	const env = process.env;
	if (!env.FLUXIFY_PAT)
		throw new Error("FLUXIFY_PAT is required: a personal access token from the portal");
	const base = env.FLUXIFY_URL || ADMIN_API_URL;
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const deps: Deps = {
		fetcher: retryRateLimit((p, init) => fetch(`${base}${p}`, init)),
		auth: { authorization: `Bearer ${env.FLUXIFY_PAT}` },
		model: modelFromEnv(env),
		judgeModel: values["no-judge"] ? undefined : judgeFromEnv(env),
		limits: limitsFromEnv(env),
		env,
		outDir: path.join(import.meta.dir, "../../../logs/evals", stamp),
		keep: values.keep,
		write: (s) => process.stdout.write(s),
	};
	const list = pickTasks(values.task);
	const current: { ctrl?: AbortController; stopped?: boolean } = {};
	process.on("SIGINT", () => {
		if (current.stopped) process.exit(130);
		current.stopped = true;
		current.ctrl?.abort(new Error("Stopped by user"));
		process.stdout.write("\n[stopping: cleaning up the current task; Ctrl+C again quits now]\n");
	});
	const { rows, report } = await runAll(list, deps, current);
	console.log(`\n${report}\n\nSaved to ${deps.outDir}`);
	if (!values.task && !current.stopped) {
		appendResults(
			path.join(import.meta.dir, "results.md"),
			resultsRow(rows, `${env.AGENT_PROVIDER}/${env.AGENT_MODEL}`),
		);
		console.log("Added a row to evals/results.md");
	}
	process.exit(0);
}
