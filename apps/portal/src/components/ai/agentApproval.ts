import { type ChatMessage, type ToolPart, toolTitle } from "./agentMessages";

/** What the approval bar asks about: the call waiting for an answer, or a finished plan in plan mode. */
export type ApprovalRequest =
	| {
			kind: "tool";
			id?: string;
			name: string;
			title: string;
			input: unknown;
			isDelete: boolean;
			isProd?: boolean;
			/** promote and rollback (#739): the approver writes why, and it is saved with the deployment */
			needsComment?: boolean;
	  }
	| { kind: "plan" };

export type ToolRequest = Extract<ApprovalRequest, { kind: "tool" }>;

/** Deletes (and removals) ask in every mode; the server uses the same rule. */
export const isDeleteTool = (name: string) => /^(delete|remove)_/.test(name);

/** Promote and rollback ask in every mode, and need a comment with the approval (#739). */
export const isDeployTool = (name: string) =>
	name === "promote_version" || name === "rollback_version";

/**
 * A call that reads or changes production (#737): `env: "production"` on a read,
 * a production value or config on a save, any trigger save. The server decides
 * what asks; this only marks the card, so it follows the same shape.
 */
export function isProdCall(name: string, input: unknown) {
	const i = (input ?? {}) as Record<string, unknown>;
	if (name === "save_trigger" || isDeployTool(name)) return true;
	if (name === "save_app_config") return i.value !== undefined;
	if (name === "save_integration") return i.config !== undefined;
	return i.env === "production";
}

const unanswered = (p: { type: string }): p is ToolPart =>
	p.type === "tool" &&
	(p as ToolPart).output === undefined &&
	(p as ToolPart).error === undefined &&
	(p as ToolPart).status === undefined;

/**
 * Every call of the last assistant message that has no result, in the order the
 * model made them (the order the server answers them).
 */
export function waitingCalls(messages: ChatMessage[]): ToolRequest[] {
	const last = messages.findLast((m) => m.role === "assistant");
	return (last?.parts.filter(unanswered) ?? []).map((call) => ({
		kind: "tool",
		id: call.id,
		name: call.name,
		title: toolTitle(call),
		input: call.input,
		isDelete: isDeleteTool(call.name),
		isProd: isProdCall(call.name, call.input),
		needsComment: isDeployTool(call.name),
	}));
}

/** The first of them: the one a single approval answers. Undefined when none waits. */
export const waitingCall = (messages: ChatMessage[]): ToolRequest | undefined =>
	waitingCalls(messages)[0];

/** Plan mode ended its run with a reply: the plan, waiting for Start. */
export function planReply(messages: ChatMessage[]) {
	const last = messages.at(-1);
	const text = last?.parts.some((p) => p.type === "text" && p.text.trim());
	return last?.role === "assistant" && text ? last : undefined;
}

const short = (v: unknown, n: number) => {
	const s = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
	return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** A one-line look at a call's input for the bar: the fields people recognise first, else the JSON. */
export function summarizeInput(name: string, input: unknown): string {
	const i = (input ?? {}) as Record<string, unknown>;
	if (name === "edit_canvas" && Array.isArray(i.ops)) {
		const target = i.target as { kind?: string; id?: string } | undefined;
		const n = i.ops.length;
		return `${n} change${n === 1 ? "" : "s"} to ${target?.kind ?? "canvas"} ${target?.id ?? ""}`.trim();
	}
	const head = [i.method, i.path ?? i.name ?? i.keyName ?? i.label].filter(Boolean).join(" ");
	if (head) return short(head, 80);
	const id = Object.entries(i).find(([k]) => k.endsWith("Id") && k !== "projectId");
	return id ? `${id[0]} ${short(id[1], 40)}` : short(input, 80);
}
