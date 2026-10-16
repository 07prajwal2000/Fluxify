import { isOpen, TODO_TOOL, type Todo, type TodoStatus } from "@fluxify/ai-gateway/src/agent/todos";
import type { ChatMessage, ToolPart } from "./agentMessages";
import { isRec, rec, str } from "./preview/data";

export type { Todo, TodoStatus };
export { isOpen, TODO_TOOL };

const isTodos = (v: unknown): v is Todo[] =>
	Array.isArray(v) && v.every((t) => isRec(t) && typeof t.id === "string");

/** The whole list a finished update_todos call returned (#771): every call returns it. */
export const todosOf = (t: ToolPart): Todo[] | undefined => {
	const list = rec(t.output).todos;
	return t.name === TODO_TOOL && t.status === "done" && isTodos(list) ? list : undefined;
};

/**
 * The list now: the newest update_todos result in the chat (live ones included),
 * else `saved`, the server's list, which reaches past the loaded page.
 */
export const currentTodos = (messages: ChatMessage[], saved: Todo[] = []): Todo[] =>
	messages
		.flatMap((m) => m.parts.map((p) => (p.type === "tool" ? todosOf(p) : undefined)))
		.findLast(Boolean) ?? saved;

/** Main tasks done, of those not dropped. */
export const progressOf = (todos: Todo[]) => {
	const kept = todos.filter((t) => t.status !== "dropped");
	return { done: kept.filter((t) => t.status === "done").length, total: kept.length };
};

export const STATUS_LABEL: Record<TodoStatus, string> = {
	pending: "pending",
	in_progress: "in progress",
	done: "done",
	dropped: "dropped",
};

/** What one update_todos call changed: "Wrote 8 tasks", "Marked 1.2 done", "Cleared the list". */
export function todoChange(input: unknown): string | undefined {
	const i = rec(input);
	if (Array.isArray(i.items)) {
		const n = i.items.length;
		return n ? `Wrote ${n} task${n === 1 ? "" : "s"}` : "Cleared the list";
	}
	const status = STATUS_LABEL[str(i.status) as TodoStatus];
	return str(i.id) && status ? `Marked ${str(i.id)} ${status}` : undefined;
}

const DISMISSED = (conversationId: string) => `fluxify:ai-tasks-closed:${conversationId}`;

/** The finished list the user closed in this conversation (its JSON); none when storage fails. */
export function dismissedList(conversationId: string) {
	try {
		return localStorage.getItem(DISMISSED(conversationId));
	} catch {
		return null;
	}
}

/** Remembers a closed list; a failing storage only means it comes back on reload. */
export function dismissList(conversationId: string, key: string) {
	try {
		localStorage.setItem(DISMISSED(conversationId), key);
	} catch {}
}
