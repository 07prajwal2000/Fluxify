import { isOpen } from "../todos";
import { isRead } from "../tools";
import { type Check, calledTool, expectCall, oneRoute, type Task } from "./checks";

/** Plan suggestions and the todo list (#771). In its own file so the other task files stay under the FTA cap. */

const NOTES =
	"Build a small notes API in this project: POST /notes stores { text } in the KV store under a new id and answers { id }; GET /notes/:id answers { id, text } (404 when missing); DELETE /notes/:id removes it and answers 204. Add a test suite for each route.";

/** suggest_plan_mode came before any change. */
const suggestedFirst: Check = {
	name: "called suggest_plan_mode before changing anything",
	run: async (ctx) => {
		const at = ctx.calls.findIndex((c) => c.name === "suggest_plan_mode");
		const write = ctx.calls.findIndex((c) => c.name !== "suggest_plan_mode" && !isRead(c.name));
		if (at < 0) return { pass: false, message: "never suggested plan mode" };
		return write < 0 || at < write
			? { pass: true, message: `call ${at + 1}` }
			: { pass: false, message: `${ctx.calls[write].name} came first` };
	},
};

const neverSuggested: Check = {
	name: "did not suggest plan mode for a small change",
	run: async (ctx) =>
		ctx.calls.some((c) => c.name === "suggest_plan_mode")
			? { pass: false, message: "suggested it" }
			: { pass: true, message: "no" },
};

const todosDone: Check = {
	name: "wrote a todo list and finished every item",
	run: async (ctx) => {
		if (!ctx.todos?.length) return { pass: false, message: "no todo list" };
		return isOpen(ctx.todos)
			? { pass: false, message: JSON.stringify(ctx.todos).slice(0, 200) }
			: { pass: true, message: `${ctx.todos.length} tasks closed` };
	},
};

const compacted: Check = {
	name: "the context was summarized mid-run",
	run: async (ctx) =>
		ctx.summaries
			? { pass: true, message: `${ctx.summaries} summaries` }
			: { pass: false, message: "no summary: lower maxContextTokens" },
};

const notesWork = [
	oneRoute("POST", "/notes"),
	oneRoute("GET", "/notes/:id"),
	oneRoute("DELETE", "/notes/:id"),
	expectCall("missing note is a 404", "GET", "/notes/nope", {}, { status: 404 }),
];

export const planTasks: Task[] = [
	{
		id: "suggest-plan",
		title: "A request across several routes suggests plan mode first (#771)",
		prompt: NOTES,
		checks: [suggestedFirst, ...notesWork],
		judge: [
			"Called suggest_plan_mode with a short reason before editing anything",
			"After the user chose to continue, built the routes and checked them",
		],
	},
	{
		id: "plan-todos",
		title: "An approved plan becomes a todo list the agent finishes, through a compaction (#771)",
		modes: ["plan", "auto"],
		prompt: [NOTES, "Go ahead."],
		limits: { maxContextTokens: 20_000 },
		checks: [calledTool("update_todos"), todosDone, compacted, ...notesWork],
		judge: [
			"The plan is a numbered list of main tasks and ends by telling the user how to start",
			"After approval, its first step was update_todos with the plan's tasks",
			"Marked each task in_progress and done as it went, one at a time",
			"Kept working through the list after the context was summarized",
		],
	},
	{
		id: "no-plan-small",
		title: "A small change goes ahead without suggesting plan mode (#771)",
		prompt: 'Add GET /health that answers { "ok": true }.',
		checks: [
			neverSuggested,
			oneRoute("GET", "/health"),
			expectCall("answers ok", "GET", "/health", {}, { status: 200, body: { ok: true } }),
		],
		judge: ["Made the change directly, without suggesting a plan", "Checked it with call_route"],
	},
];
