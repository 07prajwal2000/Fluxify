import { generateText, type LanguageModel, type ModelMessage, Output } from "ai";
import { z } from "zod";
import { modelFromEnv } from "../model";

/** Per message part; a whole conversation is cut in the middle past MAX_CHARS. */
const PART_CHARS = 600;
const MAX_CHARS = 60_000;

const cut = (v: unknown, n = PART_CHARS) => {
	const s = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
	return s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s;
};

/** The conversation as plain text: user and agent text, each tool call and a trimmed result. */
export function transcript(history: ModelMessage[]): string {
	const lines: string[] = [];
	for (const m of history) {
		const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
		for (const p of parts as any[]) {
			if (p.type === "text" && p.text) lines.push(`${m.role.toUpperCase()}: ${p.text}`);
			if (p.type === "tool-call") lines.push(`TOOL CALL ${p.toolName} ${cut(p.input)}`);
			if (p.type === "tool-result")
				lines.push(`TOOL RESULT ${p.toolName} ${cut(p.output?.value ?? p.output)}`);
		}
	}
	const text = lines.join("\n");
	if (text.length <= MAX_CHARS) return text;
	const half = MAX_CHARS / 2;
	return `${text.slice(0, half)}\n… (${text.length - MAX_CHARS} chars cut) …\n${text.slice(-half)}`;
}

/** What a judge (the model, or a person / Claude Code subagent by hand) reads. */
export function judgePrompt(task: string, checklist: string[], history: ModelMessage[]) {
	return `You grade a Fluxify AI agent's work from its conversation. Fluxify is a low-code backend platform; the agent builds routes and workflows through tools.

The task it was given:
${task}

Checklist. Score each item pass or fail from what the conversation shows, with a one-line reason. Fail an item the conversation gives no evidence for.
${checklist.map((c, i) => `${i + 1}. ${c}`).join("\n")}

The conversation:
${transcript(history)}`;
}

const verdict = z.object({
	items: z.array(z.object({ item: z.string(), pass: z.boolean(), reason: z.string() })),
});
export type Verdict = z.infer<typeof verdict>["items"];

/** The judge model from AGENT_JUDGE_*, or undefined when it is not set up. */
export function judgeFromEnv(env: Record<string, string | undefined>) {
	return env.AGENT_JUDGE_PROVIDER ? modelFromEnv(env, "AGENT_JUDGE") : undefined;
}

/** Scores the checklist; the score is the passed share (0..1). */
export async function judge(
	model: LanguageModel,
	prompt: string,
	checklist: string[],
	abortSignal?: AbortSignal,
) {
	const { output } = await generateText({
		model,
		prompt,
		output: Output.object({ schema: verdict }),
		abortSignal,
	});
	// keep the checklist's own order and wording; an item the model skipped is a fail
	const items = checklist.map((item, i) => {
		const v = output.items.find((x) => x.item === item) ?? output.items[i];
		return v ? { ...v, item } : { item, pass: false, reason: "not scored" };
	});
	return { items, score: items.filter((i) => i.pass).length / (items.length || 1) };
}
