/**
 * The agent's todo list (#771), kept as the update_todos calls in the
 * conversation: no column of its own. Pure and import-free, so the portal can
 * read the same list from the same rows.
 */

export const TODO_TOOL = "update_todos";
export const MAX_TODOS = 30;
export const MAX_TODO_CHARS = 200;

export type TodoStatus = "pending" | "in_progress" | "done" | "dropped";
/** A main task (`1`, `2`, …) or a subtask (`1.1`, …). Subtasks go one level deep. */
export type Todo = { id: string; text: string; status: TodoStatus; subtasks?: Todo[] };
/** update_todos' input: `items` writes the whole list, `id` + `status` marks one item. */
export type TodoInput = {
	items?: {
		text: string;
		status?: TodoStatus;
		subtasks?: { text: string; status?: TodoStatus }[];
	}[];
	id?: string;
	status?: TodoStatus;
};

const closed = (s: TodoStatus) => s === "done" || s === "dropped";
/** The items that carry their own status: subtasks, and main tasks without any. */
const leaves = (todos: Todo[]) => todos.flatMap((t) => (t.subtasks?.length ? t.subtasks : [t]));

/** A main task with subtasks takes its status from them: done once all are done or dropped. */
function derive(t: Todo): Todo {
	const subs = t.subtasks;
	if (!subs?.length) return t;
	const status: TodoStatus = subs.every((s) => s.status === "dropped")
		? "dropped"
		: subs.every((s) => closed(s.status))
			? "done"
			: subs.some((s) => s.status !== "pending")
				? "in_progress"
				: "pending";
	return { ...t, status };
}

/** Anything left to do. */
export const isOpen = (todos: Todo[]) => leaves(todos).some((t) => !closed(t.status));

/** The task to work on: the one in progress, else the first pending one. */
export const nextTodo = (todos: Todo[]) =>
	leaves(todos).find((t) => t.status === "in_progress") ??
	leaves(todos).find((t) => t.status === "pending");

function write(items: NonNullable<TodoInput["items"]>): Todo[] | string {
	const count = items.reduce((n, t) => n + 1 + (t.subtasks?.length ?? 0), 0);
	if (count > MAX_TODOS)
		return `The list has ${count} items (tasks and subtasks); keep it to ${MAX_TODOS}.`;
	const texts = items.flatMap((t) => [t.text, ...(t.subtasks ?? []).map((s) => s.text)]);
	const long = texts.find((s) => typeof s !== "string" || !s.trim() || s.length > MAX_TODO_CHARS);
	if (long !== undefined)
		return `Each item needs a text of 1 to ${MAX_TODO_CHARS} characters: "${String(long).slice(0, 40)}…"`;
	return items.map((t, i) => ({
		id: `${i + 1}`,
		text: t.text,
		status: t.status ?? "pending",
		...(t.subtasks?.length && {
			subtasks: t.subtasks.map((s, j) => ({
				id: `${i + 1}.${j + 1}`,
				text: s.text,
				status: s.status ?? "pending",
			})),
		}),
	}));
}

function mark(todos: Todo[], id: string, status: TodoStatus): Todo[] | string {
	const set = (t: Todo) => (t.id === id ? { ...t, status } : t);
	const main = todos.find((t) => t.id === id);
	if (main?.subtasks?.length) {
		if (status !== "dropped") return `Task ${id} has subtasks: mark those instead.`;
		// dropping a main task drops what is left of it
		return todos.map((t) =>
			t.id === id
				? { ...t, subtasks: t.subtasks?.map((s) => (closed(s.status) ? s : { ...s, status })) }
				: t,
		);
	}
	if (!leaves(todos).some((t) => t.id === id))
		return `No item ${id}. Ids: ${leaves(todos)
			.map((t) => t.id)
			.join(", ")}.`;
	return todos.map((t) => ({ ...set(t), ...(t.subtasks && { subtasks: t.subtasks.map(set) }) }));
}

/** The list after one update_todos call, or why the call is refused. Statuses are checked by the tool's schema. */
export function applyTodos(todos: Todo[], input: TodoInput): Todo[] | string {
	const next = Array.isArray(input.items)
		? write(input.items)
		: input.id && input.status
			? mark(todos, String(input.id), input.status)
			: "Send items (the whole list) or id with status (one item).";
	if (typeof next === "string") return next;
	const busy = leaves(next).filter((t) => t.status === "in_progress");
	if (busy.length > 1)
		return `Only one item can be in_progress at a time (now ${busy.map((t) => t.id).join(", ")}). Mark the finished one done first.`;
	return next.map(derive);
}

type Part = {
	type?: string;
	toolName?: string;
	toolCallId?: string;
	input?: unknown;
	output?: any;
};
type Message = { role: string; content: unknown };
const FAILED = ["error-text", "error-json", "execution-denied"];

/**
 * The current list: every update_todos call that succeeded, replayed in order.
 * `history` is the stored conversation (every row, summarized or not).
 */
export function todosOf(history: Message[]): Todo[] {
	const calls: Part[] = [];
	const ok = new Set<string>();
	for (const m of history) {
		if (!Array.isArray(m.content)) continue;
		for (const p of m.content as Part[]) {
			if (p.toolName !== TODO_TOOL) continue;
			if (p.type === "tool-call") calls.push(p);
			if (p.type === "tool-result" && !FAILED.includes(p.output?.type))
				ok.add(String(p.toolCallId));
		}
	}
	let todos: Todo[] = [];
	for (const c of calls) {
		if (!ok.has(String(c.toolCallId))) continue;
		const next = applyTodos(todos, (c.input ?? {}) as TodoInput);
		if (typeof next !== "string") todos = next;
	}
	return todos;
}

const MARK: Record<TodoStatus, string> = {
	pending: "[ ]",
	in_progress: "[~]",
	done: "[x]",
	dropped: "[-]",
};

/** The list as plain lines, for the terminal and the summary. */
export const todoLines = (todos: Todo[]) =>
	todos
		.flatMap((t) => [
			`${t.id}. ${MARK[t.status]} ${t.text}`,
			...(t.subtasks ?? []).map((s) => `   ${s.id} ${MARK[s.status]} ${s.text}`),
		])
		.join("\n");
