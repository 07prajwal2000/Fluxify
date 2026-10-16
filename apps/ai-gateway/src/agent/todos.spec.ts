import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { summarize } from "./summary";
import { applyTodos, isOpen, nextTodo, type Todo, todosOf } from "./todos";
import { keepSet } from "./trim";

const write = (items: unknown, todos: Todo[] = []) => applyTodos(todos, { items } as never) as Todo[];
const call = (id: string, input: unknown): ModelMessage => ({
	role: "assistant",
	content: [{ type: "tool-call", toolCallId: id, toolName: "update_todos", input }],
});
const result = (id: string, ok = true): ModelMessage => ({
	role: "tool",
	content: [
		{
			type: "tool-result",
			toolCallId: id,
			toolName: "update_todos",
			output: ok ? { type: "json", value: {} } : { type: "error-text", value: "no" },
		},
	],
});

describe("applyTodos", () => {
	it("numbers main tasks and subtasks, and a main task takes its status from its subtasks", () => {
		const list = write([{ text: "a", subtasks: [{ text: "a1" }, { text: "a2", status: "done" }] }, { text: "b" }]);
		expect(list.map((t) => [t.id, t.status])).toEqual([
			["1", "in_progress"],
			["2", "pending"],
		]);
		expect(list[0].subtasks?.map((s) => s.id)).toEqual(["1.1", "1.2"]);
		const done = applyTodos(list, { id: "1.1", status: "dropped" }) as Todo[];
		expect(done[0].status).toBe("done");
		expect(nextTodo(done)?.id).toBe("2");
	});

	it("marks one item; a main task with subtasks can only be dropped, which drops what is left", () => {
		const list = write([{ text: "a", subtasks: [{ text: "a1", status: "done" }, { text: "a2" }] }]);
		expect(applyTodos(list, { id: "1", status: "done" })).toContain("has subtasks");
		const dropped = applyTodos(list, { id: "1", status: "dropped" }) as Todo[];
		expect(dropped[0].subtasks?.map((s) => s.status)).toEqual(["done", "dropped"]);
		expect(dropped[0].status).toBe("done");
		expect(isOpen(dropped)).toBe(false);
		expect(applyTodos(list, { id: "9", status: "done" })).toContain("No item 9");
	});

	it("refuses more than 30 items, a text over 200 characters, and two in_progress", () => {
		const thirty = Array.from({ length: 30 }, (_, i) => ({ text: `t${i}` }));
		expect(write(thirty)).toHaveLength(30);
		expect(applyTodos([], { items: [...thirty.slice(1), { text: "x", subtasks: [{ text: "y" }] }] })).toContain(
			"31 items",
		);
		expect(applyTodos([], { items: [{ text: "x".repeat(201) }] })).toContain("200 characters");
		expect(applyTodos([], { items: [{ text: "" }] })).toContain("200 characters");
		const two = [
			{ text: "a", status: "in_progress" },
			{ text: "b", status: "in_progress" },
		] as const;
		expect(applyTodos([], { items: [...two] })).toContain("Only one item");
		const one = write([{ text: "a", status: "in_progress" }, { text: "b" }]);
		expect(applyTodos(one, { id: "2", status: "in_progress" })).toContain("Only one item");
	});

	it("needs items or id with status", () => {
		expect(applyTodos([], { id: "1" })).toContain("Send items");
	});

	it("next is the item in progress, else the first pending one", () => {
		const list = write([{ text: "a", status: "done" }, { text: "b" }, { text: "c", status: "in_progress" }]);
		expect(nextTodo(list)?.id).toBe("3");
		expect(nextTodo(write([{ text: "a", status: "done" }, { text: "b" }]))?.id).toBe("2");
		expect(nextTodo(write([{ text: "a", status: "done" }]))).toBeUndefined();
	});
});

describe("todosOf", () => {
	it("replays the successful calls in order: writes, updates and a clear", () => {
		const history: ModelMessage[] = [
			{ role: "user", content: "go ahead" },
			call("a", { items: [{ text: "one" }, { text: "two" }] }),
			result("a"),
			call("b", { id: "1", status: "done" }),
			result("b"),
			// refused when it ran: skipped
			call("c", { id: "2", status: "nope" }),
			result("c", false),
			// no result (the run stopped first): skipped
			call("d", { items: [] }),
		];
		expect(todosOf(history).map((t) => t.status)).toEqual(["done", "pending"]);
		expect(todosOf([...history, call("e", { items: [] }), result("e")])).toEqual([]);
	});

	it("is empty with no calls", () => {
		expect(todosOf([{ role: "user", content: "hi" }])).toEqual([]);
	});
});

describe("the list survives compaction", () => {
	it("keepSet keeps the latest update_todos result", () => {
		const history = [call("a", { items: [{ text: "x" }] }), result("a"), call("b", { id: "1", status: "done" }), result("b")];
		const keep = keepSet(history);
		expect(keep.has("b")).toBe(true);
		expect(keep.has("a")).toBe(false);
	});

	const chat: ModelMessage[] = [
		{ role: "user", content: "build a route" },
		{ role: "assistant", content: "built" },
		{ role: "user", content: "now test it" },
		{ role: "assistant", content: "tested" },
	];
	const model = new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [{ type: "text", text: "the summary" }],
			finishReason: { unified: "stop", raw: "stop" },
			usage: {
				inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: 1, text: 1, reasoning: 0 },
			},
			warnings: [],
		}),
	});

	it("a summary ends with the todo list while it has open items", async () => {
		const open = write([{ text: "save the route", status: "done" }, { text: "test it" }]);
		const r = await summarize(model, chat, { todos: () => open });
		const text = r?.messages[0].content as string;
		expect(text).toContain("Current todo list");
		expect(text).toContain("1. [x] save the route\n2. [ ] test it");
		const closed = write([{ text: "save the route", status: "done" }]);
		const none = await summarize(model, chat, { todos: () => closed });
		expect(none?.messages[0].content as string).not.toContain("Current todo list");
	});
});
