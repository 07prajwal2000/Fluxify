import { isStepCount, type LanguageModel, type ModelMessage, streamText, type Tool } from "ai";
import { type Limits, withModelTimeouts, withToolTimeouts } from "./timeouts";

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
- search_docs when unsure. list_advanced_tools and load_tools give you deletes, members, packages, integrations and more.

Check your work, every time:
1. Make the change (save_* and get_canvas then edit_canvas with the version you read).
2. Run edit_canvas with validate: true and fix every error.
3. Exercise it: call_route for a route, run_test_suite for a suite.
4. On failure read get_system_logs and get_recording, fix, and go again.
Only say it is done when the check passed. End with a short summary of what you changed and how you checked it.`;

type Run = {
	model: Exclude<LanguageModel, string>;
	tools: Record<string, Tool>;
	active: () => string[];
	projectId: string;
	/** The conversation so far, ending on the new user message. Each finished step is appended to it. */
	history: ModelMessage[];
	limits: Limits;
	abortSignal?: AbortSignal;
	/** A model call is being retried (idle timeout, or a 429/5xx). */
	onRetry?: (why: string) => void;
};

/**
 * One tool loop: it stops when the model answers without a tool call, or at
 * MAX_STEPS. Every write runs; there is no approval yet. Progress comes out of
 * `result.stream`; timeouts end a model call with an error part, never a hang.
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
	abortSignal,
	onRetry,
}: Run) {
	let error = "";
	return streamText({
		model: withModelTimeouts(model, limits, onRetry ?? (() => {})),
		instructions: agentPrompt(projectId),
		messages: [...history],
		tools: withToolTimeouts(tools, limits.toolMs),
		abortSignal,
		maxRetries: limits.retries,
		stopWhen: isStepCount(MAX_STEPS),
		prepareStep: ({ messages }) => {
			assertEndsOnUserOrTool(messages);
			return { activeTools: active() };
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
