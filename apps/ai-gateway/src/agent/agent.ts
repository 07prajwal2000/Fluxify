import { type LanguageModel, type ModelMessage, NoSuchToolError, streamText, type Tool } from "ai";
import { anthropicCache } from "./cache";
import { type Compaction, compactor, type SummaryCompaction } from "./compact";
import {
	budgetLine,
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
import { type Effort, providerOf, thinkingOptions } from "./model";
import { type Limits, withModelTimeouts, withToolTimeouts } from "./timeouts";
import { closeMatches, isDelete, isRead, type Mode, needsApproval } from "./tools";

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
- To change part of a script, use an edit_code op in edit_canvas (exact old and new text), not update_block with the whole script. On a big canvas call get_canvas with compact: true, then blocks: [keys] for the ones you will edit.
- Leave notes for the next reader: a short blockDescription on a block whose purpose is not obvious (a workaround, a contract, why a value is parked in a variable), and a sticky_note block for a rule the whole canvas follows. get_canvas shows them; read them before you change plumbing that looks pointless.
- Don't invent topology or style rules. One response block per happy path is fine; don't force several terminal paths onto one block. Never write a note that states a rule the canvas doesn't already follow.
- Keep notes true: after an edit, re-check every blockDescription and sticky note (yours or earlier ones) against the new edges, and fix any the edit made false in the same edit_canvas call.
- Block names (blockName) are unique per canvas and say where the block sits ("200 OK: cached users", "200 OK: users from DB"). Rename a block when you clone it.
- Say "no behaviour change" only after you call the rewired branch with input that takes it (call_route or a test suite), not just any 200.
- search_docs when unsure. list_advanced_tools and load_tools give you deletes, members, packages, integrations and more.

Referring to resources: when you mention one that exists, write :ref[Label]{type=<type> id=<id>} instead of a bare name or path ("see :ref[GET /users]{type=route id=abc}", not "see the /users api"). The chat shows it as a link. Types: route, workflow, trigger, custom_block, middleware, integration, app_config, test_suite. Take the id from list, get or what a save returned; never invent one.

Check your work, every time:
1. Make the change (save_* and get_canvas then edit_canvas with the version you read).
2. Fix every error edit_canvas returns in issues.
3. Exercise it: call_route for a route (it returns the real error and a short trace of the blocks that ran), run_test_suite for a suite.
4. On failure read the error and trace, then get_system_logs and get_recording if still unclear. Fix, and go again.
Only say it is done when the check passed. Stop when the tests pass / the route works; don't keep polishing. End with a short summary of what you changed and how you checked it.`;

const PLAN_PROMPT = `

Plan mode: you only have read tools. Look at what exists, then reply with a short numbered plan: what you will create or change, and how you will check it. Change nothing now; the user reviews the plan first.`;

/** A tool call waiting for the user. */
export type PendingCall = {
	toolCallId: string;
	toolName: string;
	input: unknown;
	isDelete: boolean;
};
/**
 * `always` approves the tool for the rest of the session (ignored for deletes).
 * `defer` answers later: the call is left without a result and the run ends,
 * waiting for the user (the web path; see continueConversation).
 */
export type Approval =
	| { ok: true; always?: boolean }
	| { ok: false; reason?: string; defer?: boolean };
/** Asks the user (terminal, UI, …). `signal` fires when the run is stopped. */
export type Approve = (call: PendingCall, signal?: AbortSignal) => Promise<Approval>;

/** The tool result for a rejected call: names the tool and the way on, so the model neither retries it blindly nor stalls (#672). */
export const rejected = (toolName: string, reason?: string) =>
	`The user did not approve ${toolName}${reason ? `: ${reason}` : ""}. Ask them, or continue without it.`;

/** Approves everything, for unattended runs (evals). */
export const approveAll: Approve = async () => ({ ok: true });

/** A step or token limit was hit. true grants another block of the same size; false stops the run. */
export type OnLimit = (limit: Limit, signal?: AbortSignal) => Promise<boolean>;

/**
 * Why a run stopped early, as clients see it (#647); the user goes on with a new message.
 * `restarted`: the gateway died mid-run and the run was released (#696).
 */
export type StopReason = "step_limit" | "token_budget" | "restarted";
export const stopReason = (s?: Stop): StopReason | undefined =>
	s?.kind === "steps" ? "step_limit" : s?.kind === "tokens" ? "token_budget" : undefined;

type Run = {
	model: Exclude<LanguageModel, string>;
	tools: Record<string, Tool>;
	active: () => string[];
	/** Marks an advanced tool loaded (agentTools' `load`); without it a call to an unloaded tool stays an error. */
	load?: (name: string) => boolean;
	projectId: string;
	/** The conversation so far, ending on the new user message. Each finished step is appended to it. */
	history: ModelMessage[];
	limits: Limits;
	mode: Mode;
	/** Thinking level (`none` turns it off); sent only for models known to support it. */
	effort?: Effort;
	approve: Approve;
	/** Asked at the step cap and the token budget; stops when missing. */
	onLimit?: OnLimit;
	/** Tools approved for the session with "always"; filled as the user answers. */
	allowed?: Set<string>;
	abortSignal?: AbortSignal;
	/** A model call is being retried (idle timeout, or a 429/5xx). */
	onRetry?: (why: string) => void;
	/** Each finished message, in order, once (persistence; the CLI passes none). */
	onMessages?: (messages: ModelMessage[]) => void | Promise<void>;
	/** A trim batch ran; resume saves its line with the next message. */
	onTrim?: (event: Extract<Compaction, { kind: "trim" }>) => void;
	/** A summary replaced `covered` in history. A throw keeps the history as it was. */
	onSummary?: (
		summary: ModelMessage,
		covered: ModelMessage[],
		event: SummaryCompaction,
	) => Promise<void>;
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
	load,
	projectId,
	history,
	limits,
	mode,
	effort,
	approve,
	onLimit = async () => false,
	allowed = new Set(),
	abortSignal,
	onRetry,
	onMessages,
	onTrim,
	onSummary,
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
	/**
	 * Reports history[from..] after an optional note. A note appended to a
	 * message reported earlier goes out as its own message.
	 */
	const flush = async (from: number, note?: string) => {
		if (note) addNote(history, note);
		const out = history.slice(from);
		if (note && !out.length) out.push({ role: "assistant", content: note });
		if (out.length) await onMessages?.(out);
	};
	/** The stop note, once (an abort can report more than once). */
	const noteStop = async (s: Stop | undefined) => {
		if (!s || noted) return;
		noted = true;
		await flush(history.length, stopNote(s));
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
	const instructions = agentPrompt(projectId) + (mode === "plan" ? PLAN_PROMPT : "");
	const timed = withModelTimeouts(model, limits, onRetry ?? (() => {}));
	let compacting = false;
	const watchers = new Set<(on: boolean) => void>();
	const compact = compactor({
		model: timed,
		history,
		instructions,
		context: limits.maxContextTokens,
		// not the guarded set: the summary's canvas reads are not the model's calls to count
		tools: withToolTimeouts(tools, limits.toolMs),
		abortSignal,
		onCompacting: (on) => {
			compacting = on;
			for (const w of watchers) w(on);
		},
		onTrim,
		onSummary,
	});
	// plan mode: load_tools must not offer write tools as usable now
	const guarded = guardTools(
		withToolTimeouts(mode === "plan" ? planTools(tools) : tools, limits.toolMs),
		guard,
		limits.maxResultChars ?? MAX_RESULT_CHARS,
	);
	const providerOptions = effort
		? thinkingOptions(providerOf(model), model.modelId, effort)
		: undefined;
	const result = streamText({
		tools: guarded,
		model: timed,
		providerOptions: providerOptions as never,
		instructions,
		messages: [...history],
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
		// Built from `history` each step: the 60% trim is never stored, the 80% summary is. The budget line is the one thing added after.
		prepareStep: async ({ steps }) => {
			const sent = await compact.next(steps.at(-1)?.usage);
			assertEndsOnUserOrTool(sent);
			const cache = anthropicCache(model, instructions, sent);
			// after the cache breakpoint, and not in `history`: it changes every step
			const budget = budgetLine(steps.length + 1, max.steps, tokens(steps), max.tokens);
			return {
				activeTools: mode === "plan" ? active().filter(isRead) : active(),
				...cache,
				messages: [...(cache.messages ?? sent), { role: "user" as const, content: budget }],
			};
		},
		// A call to a real tool that is not active yet (#699): parsing only sees `activeTools`,
		// but execution and toolApproval use all of `tools`. `step` is the filtered set the SDK
		// parses against again after this returns, so adding the tool there runs it in this step.
		experimental_repairToolCall: async ({ toolCall, tools: step, error }) => {
			const name = toolCall.toolName;
			if (!NoSuchToolError.isInstance(error)) return null;
			if (!Object.hasOwn(guarded, name)) {
				const near = closeMatches(name);
				throw new Error(
					`No tool named ${name}.${near.length ? ` Close matches: ${near.join(", ")}.` : ""} Use list_advanced_tools to see more.`,
				);
			}
			if (mode === "plan" && !isRead(name))
				throw new Error(
					`${name} changes things; plan mode is read-only. Put it in the plan instead.`,
				);
			load?.(name);
			(step as Record<string, Tool>)[name] = guarded[name];
			return toolCall;
		},
		toolApproval: async ({ toolCall: { toolCallId, toolName, input } }) => {
			const del = isDelete(toolName);
			if (!needsApproval(mode, toolName) || (!del && allowed.has(toolName))) return undefined;
			const r = await Promise.race([
				approve({ toolCallId, toolName, input, isDelete: del }, abortSignal),
				stopped,
			]);
			if (!r.ok && r.defer) return "user-approval";
			if (!r.ok) return { type: "denied", reason: rejected(toolName, r.reason) };
			if (r.always && !del) allowed.add(toolName);
			return "approved";
		},
		// Errors already come out of the stream as parts; the default also logs them.
		onError: ({ error: e }) => {
			error = e instanceof Error ? e.message : String(e);
		},
		onStepEnd: async (step) => {
			const from = history.length;
			history.push(...step.response.messages);
			const failed = step.finishReason === "error";
			await flush(
				from,
				failed ? `(previous reply failed: ${error || "unknown error"})` : undefined,
			);
		},
		// After the last step is in history, so the note lands after its tool results.
		onFinish: () => noteStop(stop),
		// Ctrl+C at the limit prompt: the run is aborted, but history still says why.
		onAbort: () => noteStop(asking ?? stop),
	});
	return Object.assign(result, {
		stopped: () => stop,
		compactions: compact.events,
		/** Calls `fn(true)` when a summary starts and `fn(false)` when it ends (now too, if one is running). */
		whenCompacting: (fn: (on: boolean) => void) => {
			watchers.add(fn);
			if (compacting) fn(true);
		},
	});
}

/** In plan mode load_tools still loads (for after the plan) but only reports read tools as usable. */
export function planTools(tools: Record<string, Tool>): Record<string, Tool> {
	const load = tools.load_tools;
	if (!load?.execute) return tools;
	const execute = load.execute;
	return {
		...tools,
		load_tools: {
			...load,
			execute: async (input: any, opts: any) => {
				const r = await execute(input, opts);
				const writes = r.loaded.filter((n: string) => !isRead(n));
				if (!writes.length) return r;
				return {
					...r,
					loaded: r.loaded.filter(isRead),
					notInPlanMode: writes,
					note: "Plan mode is read-only: these write tools work only after the user approves the plan.",
				};
			},
		} as Tool,
	};
}

/** Mistral (and others) 400 when the last message is assistant or system. */
export function assertEndsOnUserOrTool(messages: ModelMessage[]) {
	const role = messages.at(-1)?.role;
	if (role !== "user" && role !== "tool")
		throw new Error(`Refusing to call the model: the last message is "${role}", not user or tool.`);
}
