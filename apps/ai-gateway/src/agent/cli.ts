import type { EventEmitter } from "node:events";
import path from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import type { ModelMessage } from "ai";
import { ADMIN_API_URL } from "../lib/env";
import { runAgent } from "./agent";
import { modelFromEnv } from "./model";
import { type Log, printRun, runLog } from "./progress";
import { limitsFromEnv } from "./timeouts";
import { agentTools } from "./tools";

export { printRun, short } from "./progress";

/**
 * Terminal agent against a Fluxify admin API, acting as the user behind FLUXIFY_PAT.
 *   bun run agent ["<first prompt>"] --project <id>
 * Then `> ` takes the next message. /exit quits; Ctrl+C stops a run, twice at an empty prompt quits.
 * Env: AGENT_PROVIDER, AGENT_MODEL, AGENT_API_KEY, AGENT_BASE_URL, FLUXIFY_PAT,
 * FLUXIFY_URL (the admin server, http://127.0.0.1:$SERVER_PORT by default),
 * AGENT_CHUNK_TIMEOUT_MS (60000), AGENT_MODEL_TIMEOUT_MS (180000), AGENT_TOOL_TIMEOUT_MS (120000),
 * AGENT_MAX_RETRIES (5: retries of a 429/5xx, backoff 2s doubling, or the provider's retry-after under 60s).
 * Each session logs to apps/ai-gateway/logs/agent-<time>.log.
 * Evals: bun run agent:evals [--task id,...] [--keep] [--no-judge]; env and output in evals/run.ts.
 */

type Session = {
	history: ModelMessage[];
	abortSignal?: AbortSignal;
	onRetry?: (why: string) => void;
};

/** Builds the agent from env and runs the conversation in `history` (ending on the user's message). */
export function startAgent(projectId: string, { history, abortSignal, onRetry }: Session) {
	const pat = process.env.FLUXIFY_PAT;
	if (!pat) throw new Error("FLUXIFY_PAT is required: a personal access token from the portal");
	const base = process.env.FLUXIFY_URL || ADMIN_API_URL;
	const { tools, active } = agentTools(
		(p, init) => fetch(`${base}${p}`, init),
		{ authorization: `Bearer ${pat}` },
		projectId,
	);
	const model = modelFromEnv(process.env);
	const limits = limitsFromEnv(process.env);
	return runAgent({ model, tools, active, projectId, history, limits, abortSignal, onRetry });
}

/** What a line typed at `> ` means. */
export function parseLine(line: string): "skip" | "exit" | "unknown" | "run" {
	const t = line.trim();
	if (!t) return "skip";
	if (t === "/exit") return "exit";
	return t.startsWith("/") ? "unknown" : "run";
}

/** What Ctrl+C does: stop the run, clear a typed line, or quit on the second press at an empty prompt. */
export function onInterrupt(s: { running: boolean; line: string; armed: boolean }) {
	if (s.running) return "stop";
	if (s.line) return "clear";
	return s.armed ? "quit" : "arm";
}

/** One user message: runs it, renders it, logs it. Finished steps land in `history`. */
async function turn(
	projectId: string,
	history: ModelMessage[],
	prompt: string,
	signal: AbortSignal,
	log: Log,
) {
	const write = (s: string) => process.stdout.write(s);
	history.push({ role: "user", content: prompt });
	log("prompt", { chars: prompt.length });
	const onRetry = (why: string) => {
		write(`\n[retry] ${why}\n`);
		log("retry", { why });
	};
	const result = startAgent(projectId, { history, abortSignal: signal, onRetry });
	await printRun(result, { write, tty: process.stdout.isTTY, log });
}

async function repl(projectId: string, first: string | undefined) {
	const { file, log } = runLog(path.join(import.meta.dir, "../../logs"));
	console.log(`Log: ${file}\n/exit quits. Ctrl+C stops a run.`);
	const history: ModelMessage[] = [];
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const ask = () => new Promise<string>((resolve) => rl.question("> ", resolve));
	let run: AbortController | undefined;
	let armed = false;
	const quit = () => {
		rl.close();
		process.exit(0);
	};
	const interrupt = () => {
		const what = onInterrupt({ running: !!run, line: rl.line, armed });
		if (what === "stop") run?.abort(new Error("Stopped by user"));
		if (what === "clear") rl.write(null, { ctrl: true, name: "u" });
		if (what === "arm") process.stdout.write("\n(Ctrl+C again to quit)\n> ");
		if (what === "quit") quit();
		armed = what === "stop" || what === "arm";
	};
	// @types/node 26 merges the emitter methods in a way tsgo misses.
	(rl as unknown as EventEmitter).on("SIGINT", interrupt);
	process.on("SIGINT", interrupt);
	for (let line = first ?? (await ask()); ; line = await ask()) {
		const kind = parseLine(line);
		if (kind === "exit") quit();
		if (kind === "unknown") console.log("Commands: /exit");
		if (kind !== "run") continue;
		armed = false;
		run = new AbortController();
		try {
			await turn(projectId, history, line.trim(), run.signal, log);
		} catch (e) {
			console.error(`\n[error] ${e instanceof Error ? e.message : e}`);
		}
		run = undefined;
		process.stdout.write("\n");
	}
}

if (import.meta.main) {
	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		options: { project: { type: "string" } },
		allowPositionals: true,
	});
	if (!values.project) {
		console.error('Usage: bun run agent ["<prompt>"] --project <projectId>');
		process.exit(1);
	}
	await repl(values.project, positionals.join(" ") || undefined);
}
