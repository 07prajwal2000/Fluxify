import { isStepCount, type LanguageModel, type ModelMessage, streamText, type Tool } from "ai";
import { type Limits, withModelTimeouts, withToolTimeouts } from "./timeouts";
import { isDelete, isRead, type Mode, needsApproval } from "./tools";

export const MAX_STEPS = 40;

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

export const rejected = (reason?: string) =>
	reason ? `The user rejected this call: ${reason}` : "The user rejected this call.";

/** Approves everything, for unattended runs (evals). */
export const approveAll: Approve = async () => ({ ok: true });

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
	/** Tools approved for the session with "always"; filled as the user answers. */
	allowed?: Set<string>;
	abortSignal?: AbortSignal;
	/** A model call is being retried (idle timeout, or a 429/5xx). */
	onRetry?: (why: string) => void;
};

/**
 * One tool loop: it stops when the model answers without a tool call, or at
 * MAX_STEPS. Calls that `needsApproval` wait for `approve` (the SDK's
 * toolApproval, so a rejection is the call's result and the loop goes on).
 * Plan mode only gets read tools. Progress comes out of `result.stream`;
 * timeouts end a model call with an error part, never a hang.
 */
export const STEP_LIMIT_NOTE = `(stopped: reached the ${MAX_STEPS}-step limit before finishing)`;

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

export function runAgent({
	model,
	tools,
	active,
	projectId,
	history,
	limits,
	mode,
	approve,
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
	return streamText({
		model: withModelTimeouts(model, limits, onRetry ?? (() => {})),
		instructions: agentPrompt(projectId) + (mode === "plan" ? PLAN_PROMPT : ""),
		messages: [...history],
		tools: withToolTimeouts(tools, limits.toolMs),
		abortSignal,
		maxRetries: limits.retries,
		stopWhen: isStepCount(MAX_STEPS),
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
			if (!r.ok) return { type: "denied", reason: rejected(r.reason) };
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
			else if (step.finishReason === "tool-calls" && step.stepNumber + 1 >= MAX_STEPS)
				addNote(history, STEP_LIMIT_NOTE);
		},
	});
}

/** Mistral (and others) 400 when the last message is assistant or system. */
export function assertEndsOnUserOrTool(messages: ModelMessage[]) {
	const role = messages.at(-1)?.role;
	if (role !== "user" && role !== "tool")
		throw new Error(`Refusing to call the model: the last message is "${role}", not user or tool.`);
}
