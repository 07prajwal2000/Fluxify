import { type LanguageModel, type ModelMessage, streamText, type Tool } from "ai";
import {
	guardTools,
	type Limit,
	MAX_RESULT_CHARS,
	MAX_STEPS,
	newGuard,
	type Stop,
	stopNote,
	TOKEN_BUDGET,
	WRAP_UP,
} from "./guards";
import { type Limits, withModelTimeouts, withToolTimeouts } from "./timeouts";
import { isDelete, isRead, type Mode, needsApproval } from "./tools";

export { type Limit, MAX_STEPS } from "./guards";

export const agentPrompt = (
	projectId: string,
) => `You are the Fluxify agent. Fluxify is a low-code backend platform: you build HTTP routes and background workflows as canvases (graphs of blocks).

You work in project ${projectId}. Every tool acts as the signed-in user with their project role. A "You need the X role" error means stop and tell the user.

Basics:
- Route: an HTTP endpoint. Its canvas starts at the entrypoint block and ends at a response block. A new route is inactive until saved with active: true.
- Workflow: a background job with its own canvas, started by a trigger (e.g. a schedule).
- Custom block: reusable JavaScript with typed inputs. Middleware: a chain of custom blocks around a route.
- App config holds settings and secrets by key. Integrations are databases, KV stores, AI providers and queues.
- Use list and get to see what exists. get_block_schemas (no input) lists blocks; with blockTypes it gives their exact fields.
- Block text inputs are literal unless they start with \`js:\` followed by code that returns the value (e.g. \`js: return input.id\`); never use \`{{ }}\`.
- search_docs when unsure. list_advanced_tools and load_tools give you deletes, members, packages, integrations and more.

Check your work, every time:
1. Make the change (save_* and get_canvas then edit_canvas with the version you read).
2. Run edit_canvas with validate: true and fix every error.
3. Exercise it: call_route for a route, run_test_suite for a suite.
4. On failure read get_system_logs and get_recording, fix, and go again.
Only say it is done when the check passed. End with a short summary of what you changed and how you checked it.`;

const PLAN_PROMPT = `

Plan mode: you only have read tools. Look at what exists, then reply with a short numbered plan: what you will create or change, and how you will check it. Change nothing now; the user reviews the plan first.`;

/** A tool call waiting for the user. */
export type PendingCall = {
	toolCallId: string;
	toolName: string;
	input: unknown;
	isDelete: boolean;
};
/** `always` approves the tool for the rest of the session (ignored for deletes). */
export type Approval = { ok: true; always?: boolean } | { ok: false; reason?: string };
/** Asks the user (terminal, UI, …). `signal` fires when the run is stopped. */
export type Approve = (call: PendingCall, signal?: AbortSignal) => Promise<Approval>;

/** The tool result for a rejected call: names the tool and the way on, so the model neither retries it blindly nor stalls (#672). */
export const rejected = (toolName: string, reason?: string) =>
	`The user did not approve ${toolName}${reason ? `: ${reason}` : ""}. Ask them, or continue without it.`;

/** Approves everything, for unattended runs (evals). */
export const approveAll: Approve = async () => ({ ok: true });

/** A step or token limit was hit. true grants another block of the same size; false stops the run. */
export type OnLimit = (limit: Limit, signal?: AbortSignal) => Promise<boolean>;

type Run = {
	model: Exclude<LanguageModel, string>;
	tools: Record<string, Tool>;
	active: () => string[];
	projectId: string;
	/** The conversation so far, ending on the new user message. Each finished step is appended to it. */
	history: ModelMessage[];
	limits: Limits;
	mode: Mode;
	approve: Approve;
	/** Asked at the step cap and the token budget; stops when missing. */
	onLimit?: OnLimit;
	/** Tools approved for the session with "always"; filled as the user answers. */
	allowed?: Set<string>;
	abortSignal?: AbortSignal;
	/** A model call is being retried (idle timeout, or a 429/5xx). */
	onRetry?: (why: string) => void;
};

/**
 * Leaves a note on why the reply ended early as the last assistant turn, so
 * the next turn knows. Appends to the last assistant message when there is one,
 * so roles keep alternating.
 */
export function addNote(history: ModelMessage[], note: string) {
	const last = history.at(-1);
	if (last?.role !== "assistant") {
		history.push({ role: "assistant", content: note });
		return;
	}
	const parts =
		typeof last.content === "string"
			? [{ type: "text" as const, text: last.content }]
			: last.content;
	last.content = [...parts, { type: "text", text: note }];
}

const tokens = (steps: { usage: { inputTokens?: number; outputTokens?: number } }[]) =>
	steps.reduce((n, s) => n + (s.usage.inputTokens ?? 0) + (s.usage.outputTokens ?? 0), 0);

/**
 * One tool loop: it stops when the model answers without a tool call. At the
 * step cap or token budget it asks `onLimit` (a stop condition may be async, so
 * the run just waits; yes raises the limit). A call repeated REPEAT_STOP times
 * stops it. Calls that `needsApproval` wait for `approve` (the SDK's
 * toolApproval, so a rejection is the call's result and the loop goes on).
 * Plan mode only gets read tools. Progress comes out of `result.stream`;
 * timeouts end a model call with an error part, never a hang. `stopped()` says
 * why the run ended early, if it did.
 */
export function runAgent({
	model,
	tools,
	active,
	projectId,
	history,
	limits,
	mode,
	approve,
	onLimit = async () => false,
	allowed = new Set(),
	abortSignal,
	onRetry,
}: Run) {
	let error = "";
	const stopped = new Promise<Approval>((resolve) =>
		abortSignal?.addEventListener("abort", () => resolve({ ok: false, reason: "stopped" }), {
			once: true,
		}),
	);
	const maxSteps = limits.maxSteps ?? MAX_STEPS;
	const budget = limits.tokenBudget ?? TOKEN_BUDGET;
	const guard = newGuard();
	const max = { steps: maxSteps, tokens: budget };
	let warned = false;
	let stop: Stop | undefined;
	/** The limit being asked about, so a stop during the prompt still leaves its note. */
	let asking: Limit | undefined;
	let noted = false;
	/** The stop note, once (an abort can report more than once). */
	const noteStop = (s: Stop | undefined) => {
		if (!s || noted) return;
		noted = true;
		addNote(history, stopNote(s));
	};
	/** Asks to go past a limit; no stops the run. */
	const pastLimit = async (kind: Limit["kind"], used: number) => {
		if (used < max[kind]) return true;
		asking = { kind, used, limit: max[kind] };
		const go = await Promise.race([onLimit(asking, abortSignal), stopped.then(() => false)]);
		const limit = asking.limit;
		asking = undefined;
		if (go) max[kind] += kind === "steps" ? maxSteps : budget;
		else stop = { kind, used, limit };
		return go;
	};
	const result = streamText({
		model: withModelTimeouts(model, limits, onRetry ?? (() => {})),
		instructions: agentPrompt(projectId) + (mode === "plan" ? PLAN_PROMPT : ""),
		messages: [...history],
		tools: guardTools(
			withToolTimeouts(tools, limits.toolMs),
			guard,
			limits.maxResultChars ?? MAX_RESULT_CHARS,
		),
		abortSignal,
		maxRetries: limits.retries,
		stopWhen: async ({ steps }) => {
			if (guard.repeat) stop = { kind: "repeat", tool: guard.repeat };
			if (stop) return true;
			const used = tokens(steps);
			if (!warned && used >= 0.8 * max.tokens) {
				warned = true;
				guard.pending.push(WRAP_UP);
			}
			return !(await pastLimit("steps", steps.length)) || !(await pastLimit("tokens", used));
		},
		prepareStep: ({ messages }) => {
			assertEndsOnUserOrTool(messages);
			return { activeTools: mode === "plan" ? active().filter(isRead) : active() };
		},
		toolApproval: async ({ toolCall: { toolCallId, toolName, input } }) => {
			const del = isDelete(toolName);
			if (!needsApproval(mode, toolName) || (!del && allowed.has(toolName))) return undefined;
			const r = await Promise.race([
				approve({ toolCallId, toolName, input, isDelete: del }, abortSignal),
				stopped,
			]);
			if (!r.ok) return { type: "denied", reason: rejected(toolName, r.reason) };
			if (r.always && !del) allowed.add(toolName);
			return "approved";
		},
		// Errors already come out of the stream as parts; the default also logs them.
		onError: ({ error: e }) => {
			error = e instanceof Error ? e.message : String(e);
		},
		onStepEnd: (step) => {
			history.push(...step.response.messages);
			if (step.finishReason === "error")
				addNote(history, `(previous reply failed: ${error || "unknown error"})`);
		},
		// After the last step is in history, so the note lands after its tool results.
		onFinish: () => noteStop(stop),
		// Ctrl+C at the limit prompt: the run is aborted, but history still says why.
		onAbort: () => noteStop(asking ?? stop),
	});
	return Object.assign(result, { stopped: () => stop });
}

/** Mistral (and others) 400 when the last message is assistant or system. */
export function assertEndsOnUserOrTool(messages: ModelMessage[]) {
	const role = messages.at(-1)?.role;
	if (role !== "user" && role !== "tool")
		throw new Error(`Refusing to call the model: the last message is "${role}", not user or tool.`);
}
