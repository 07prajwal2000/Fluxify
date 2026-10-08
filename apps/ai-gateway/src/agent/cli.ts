import type { EventEmitter } from "node:events";
import path from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import type { ModelMessage } from "ai";
import { ADMIN_API_URL } from "../lib/env";
import {
	type Approval,
	type Approve,
	agentPrompt,
	type Limit,
	type OnLimit,
	runAgent,
} from "./agent";
import { compactionLine, summarize } from "./compact";
import { modelFromEnv } from "./model";
import { describeCall, type Log, printRun, runLog } from "./progress";
import { limitsFromEnv } from "./timeouts";
import { agentTools, MODES, type Mode } from "./tools";

export { printRun, short } from "./progress";

/**
 * Terminal agent against a Fluxify admin API, acting as the user behind FLUXIFY_PAT.
 *   bun run agent ["<first prompt>"] --project <id> [--mode manual|auto|plan]
 * Then `[mode] > ` takes the next message. /mode <name> switches mode, /compact summarizes
 * the conversation so far now, /exit quits;
 * Ctrl+C stops a run (or rejects at an approval prompt), twice at an empty prompt quits.
 * manual asks before every change, auto only before deletes (deletes always ask), plan
 * only reads and writes a plan, then asks Start? (y runs it in auto).
 * Env: AGENT_PROVIDER, AGENT_MODEL, AGENT_API_KEY, AGENT_BASE_URL, FLUXIFY_PAT,
 * FLUXIFY_URL (the admin server, http://127.0.0.1:$SERVER_PORT by default),
 * AGENT_CHUNK_TIMEOUT_MS (60000), AGENT_MODEL_TIMEOUT_MS (180000), AGENT_TOOL_TIMEOUT_MS (120000),
 * AGENT_MAX_RETRIES (5: retries of a 429/5xx, backoff 2s doubling, or the provider's retry-after under 60s),
 * AGENT_MAX_STEPS (40) and AGENT_TOKEN_BUDGET (1000000 input + output tokens): at either one the run
 * asks "Continue? [y/n]" (y grants as much again, n or Ctrl+C stops it with a note),
 * AGENT_MAX_RESULT_CHARS (50000: a longer tool result keeps its start and end; canvases are never cut).
 * AGENT_MAX_CONTEXT_TOKENS (128000: the model's context window; over 60% old tool results are trimmed
 * in the request, over 80% older turns are replaced by a summary; both print a [compacted] line).
 * Each session logs to apps/ai-gateway/logs/agent-<time>.log.
 * Evals: bun run agent:evals [--task id,...] [--keep] [--no-judge]; env and output in evals/run.ts.
 */

/** What lasts across messages: the conversation, the mode, the tools approved with "a" and the ones load_tools added. */
type Session = { history: ModelMessage[]; mode: Mode; allowed: Set<string>; loaded: Set<string> };

type Run = Session & {
	approve: Approve;
	onLimit?: OnLimit;
	abortSignal?: AbortSignal;
	onRetry?: (why: string) => void;
};

/** Builds the agent from env and runs the conversation in `history` (ending on the user's message). */
export function startAgent(projectId: string, { loaded, ...run }: Run) {
	const pat = process.env.FLUXIFY_PAT;
	if (!pat) throw new Error("FLUXIFY_PAT is required: a personal access token from the portal");
	const base = process.env.FLUXIFY_URL || ADMIN_API_URL;
	const { tools, active, load } = agentTools(
		(p, init) => fetch(`${base}${p}`, init),
		{ authorization: `Bearer ${pat}` },
		projectId,
		loaded,
	);
	const model = modelFromEnv(process.env);
	const limits = limitsFromEnv(process.env);
	return runAgent({ model, tools, active, load, projectId, limits, ...run });
}

/** What a line typed at `> ` means. `{ mode }` is /mode with its argument, if any. */
export function parseLine(
	line: string,
): "skip" | "exit" | "compact" | "unknown" | "run" | { mode?: string } {
	const t = line.trim();
	if (!t) return "skip";
	if (t === "/exit") return "exit";
	if (t === "/compact") return "compact";
	if (t === "/mode" || t.startsWith("/mode ")) return { mode: t.slice(5).trim() || undefined };
	return t.startsWith("/") ? "unknown" : "run";
}

/** An answer to `[y/n/a/reason]`; undefined means ask again. "a" is not offered for a delete. */
export function parseApproval(answer: string, isDelete: boolean): Approval | undefined {
	const t = answer.trim();
	const k = t.toLowerCase();
	if (!t || (k === "a" && isDelete)) return undefined;
	if (k === "y") return { ok: true };
	if (k === "n") return { ok: false };
	if (k === "a") return { ok: true, always: true };
	return { ok: false, reason: t };
}

/** An answer to `Start? [y/n/changes]`; undefined means ask again. */
export function parseStart(answer: string): "start" | "stay" | { changes: string } | undefined {
	const t = answer.trim();
	if (!t) return undefined;
	if (t.toLowerCase() === "y") return "start";
	if (t.toLowerCase() === "n") return "stay";
	return { changes: t };
}

/** An answer to `Continue? [y/n]`; undefined means ask again. */
export function parseYesNo(answer: string): boolean | undefined {
	const k = answer.trim().toLowerCase();
	if (k === "y" || k === "yes") return true;
	if (k === "n" || k === "no") return false;
	return undefined;
}

const fmt = (n: number) => n.toLocaleString("en-US");
export const limitPrompt = ({ kind, used, limit }: Limit) =>
	kind === "steps"
		? `Reached the ${limit}-step limit. Continue? [y/n] `
		: `Reached the token budget (${fmt(used)} / ${fmt(limit)} tokens). Continue? [y/n] `;

/** Reads one line; null when `signal` fires (Ctrl+C). */
type Ask = (prompt: string, signal?: AbortSignal) => Promise<string | null>;

/** The terminal's approver: shows the call and asks until it gets an answer. Ctrl+C rejects. */
export const cliApprover =
	(ask: Ask, write: (s: string) => void, log: Log): Approve =>
	async (call, signal) => {
		write(`\n${call.isDelete ? "Delete" : "Approve"} ${describeCall(call.toolName, call.input)}\n`);
		log("approval-request", { name: call.toolName });
		for (;;) {
			const a = await ask(call.isDelete ? "[y/n/reason] " : "[y/n/a/reason] ", signal);
			const r: Approval | undefined =
				a === null ? { ok: false, reason: "stopped by the user" } : parseApproval(a, call.isDelete);
			if (!r) continue;
			log("approval-result", { name: call.toolName, ...r });
			return r;
		}
	};

/** The terminal's answer at a step or token limit: asks until y or n. Ctrl+C is no. */
export const cliLimit =
	(ask: Ask, write: (s: string) => void, log: Log): OnLimit =>
	async (limit, signal) => {
		write("\n");
		for (;;) {
			const a = await ask(limitPrompt(limit), signal);
			const go = a === null ? false : parseYesNo(a);
			if (go === undefined) continue;
			log("limit", { ...limit, go });
			return go;
		}
	};

/** What Ctrl+C does: stop the run, clear a typed line, or quit on the second press at an empty prompt. */
export function onInterrupt(s: { running: boolean; line: string; armed: boolean }) {
	if (s.running) return "stop";
	if (s.line) return "clear";
	return s.armed ? "quit" : "arm";
}

/**
 * Runs one message. In plan mode, asks Start? after each reply: y runs the plan
 * in auto, typed changes go back in plan mode and it asks again, n stops.
 * `runOne` returns true when the run was stopped.
 */
export async function converse(
	session: Session,
	prompt: string,
	runOne: (prompt: string) => Promise<boolean>,
	askStart: () => Promise<NonNullable<ReturnType<typeof parseStart>>>,
	write: (s: string) => void,
) {
	for (let next: string | undefined = prompt; next; ) {
		const stopped = await runOne(next);
		next = undefined;
		if (session.mode !== "plan" || stopped) return;
		const answer = await askStart();
		if (answer === "start") {
			// The plan runs in auto; deletes still ask.
			session.mode = "auto";
			write("Mode: auto\n");
			next = "Go ahead with the plan.";
		} else if (answer !== "stay") next = answer.changes;
	}
}

type Ctx = {
	projectId: string;
	session: Session;
	log: Log;
	approve: Approve;
	onLimit: OnLimit;
	paused: () => boolean;
};

/** One user message: runs it, renders it, logs it. Finished steps land in `history`. */
async function turn(
	{ projectId, session, log, approve, onLimit, paused }: Ctx,
	prompt: string,
	signal: AbortSignal,
) {
	const write = (s: string) => process.stdout.write(s);
	session.history.push({ role: "user", content: prompt });
	log("prompt", { chars: prompt.length, mode: session.mode });
	const onRetry = (why: string) => {
		write(`\n[retry] ${why}\n`);
		log("retry", { why });
	};
	const result = startAgent(projectId, {
		...session,
		approve,
		onLimit,
		abortSignal: signal,
		onRetry,
	});
	await printRun(result, { write, tty: process.stdout.isTTY, log, paused });
}

/** /compact: the 80% summary now, swapped into `history`. */
export async function compactNow(
	history: ModelMessage[],
	instructions: string,
	write: (s: string) => void,
	log: Log,
	model = modelFromEnv(process.env),
) {
	try {
		const r = await summarize(model, history, { instructions });
		if (!r) return write("[compacted] nothing to compact yet\n");
		history.splice(0, history.length, ...r.messages);
		const { type: _, ...stats } = r.event;
		write(`${compactionLine(r.event)}\n`);
		log("compaction", stats);
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		write(`[compacted] summary failed: ${error}\n`);
		log("compaction", { kind: "summary-failed", error });
	}
}

async function repl(projectId: string, first: string | undefined, mode: Mode) {
	const { file, log } = runLog(path.join(import.meta.dir, "../../logs"));
	console.log(
		`Log: ${file}\n/mode <manual|auto|plan> switches mode, /exit quits. Ctrl+C stops a run.`,
	);
	const session: Session = { history: [], mode, allowed: new Set(), loaded: new Set() };
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	// @types/node 26 merges the emitter methods in a way tsgo misses.
	const events = rl as unknown as EventEmitter;
	const ask: Ask = (prompt, signal) =>
		new Promise((resolve) => {
			if (signal?.aborted) return resolve(null);
			const done = (v: string | null) => {
				events.off("line", done);
				signal?.removeEventListener("abort", stop);
				resolve(v);
			};
			const stop = () => {
				rl.write(null, { ctrl: true, name: "u" });
				process.stdout.write("\n");
				done(null);
			};
			signal?.addEventListener("abort", stop, { once: true });
			events.on("line", done);
			rl.setPrompt(prompt);
			rl.prompt();
		});
	const next = () => ask(`[${session.mode}] > `) as Promise<string>;
	let run: AbortController | undefined;
	let armed = false;
	let prompting = false;
	const quit = () => {
		rl.close();
		process.exit(0);
	};
	const interrupt = () => {
		const what = onInterrupt({ running: !!run, line: rl.line, armed });
		if (what === "stop") run?.abort(new Error("Stopped by user"));
		if (what === "clear") rl.write(null, { ctrl: true, name: "u" });
		if (what === "arm") {
			process.stdout.write("\n(Ctrl+C again to quit)\n");
			rl.prompt();
		}
		if (what === "quit") quit();
		armed = what === "stop" || what === "arm";
	};
	events.on("SIGINT", interrupt);
	process.on("SIGINT", interrupt);
	const write = (s: string) => process.stdout.write(s);
	/** Holds the status line while the user answers. */
	const held =
		<A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
		async (...a: A) => {
			prompting = true;
			if (process.stdout.isTTY) write("\r\x1b[2K");
			try {
				return await f(...a);
			} finally {
				prompting = false;
			}
		};
	const ctx: Ctx = {
		projectId,
		session,
		log,
		paused: () => prompting,
		approve: held(cliApprover(ask, write, log)),
		onLimit: held(cliLimit(ask, write, log)),
	};
	/** Runs one message under a fresh Ctrl+C scope; true when it was stopped. */
	const runOne = async (prompt: string) => {
		armed = false;
		run = new AbortController();
		try {
			await turn(ctx, prompt, run.signal);
		} catch (e) {
			console.error(`\n[error] ${e instanceof Error ? e.message : e}`);
		}
		const stopped = run.signal.aborted;
		run = undefined;
		write("\n");
		return stopped;
	};
	/** After a plan: Start? until answered. Ctrl+C counts as n. */
	const askStart = async () => {
		run = new AbortController();
		let answer: ReturnType<typeof parseStart>;
		while (!answer) {
			const a = await ask("Start? [y/n/changes] ", run.signal);
			if (a === null) break;
			answer = parseStart(a);
		}
		run = undefined;
		return answer ?? "stay";
	};
	for (let line = first ?? (await next()); ; line = await next()) {
		const kind = parseLine(line);
		if (kind === "exit") quit();
		if (kind === "compact") {
			await compactNow(session.history, agentPrompt(projectId), write, log);
			continue;
		}
		if (typeof kind === "object") {
			if (kind.mode && !MODES.includes(kind.mode as Mode))
				console.log(`Unknown mode "${kind.mode}". Use /mode manual, /mode auto or /mode plan.`);
			else if (kind.mode) session.mode = kind.mode as Mode;
			console.log(`Mode: ${session.mode}`);
			continue;
		}
		if (kind === "unknown") console.log("Commands: /mode <manual|auto|plan>, /compact, /exit");
		if (kind !== "run") continue;
		await converse(session, line.trim(), runOne, askStart, write);
	}
}

if (import.meta.main) {
	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		options: { project: { type: "string" }, mode: { type: "string", default: "manual" } },
		allowPositionals: true,
	});
	const mode = values.mode as Mode;
	if (!values.project || !MODES.includes(mode)) {
		console.error(
			'Usage: bun run agent ["<prompt>"] --project <projectId> [--mode manual|auto|plan]',
		);
		process.exit(1);
	}
	await repl(values.project, positionals.join(" ") || undefined, mode);
}
