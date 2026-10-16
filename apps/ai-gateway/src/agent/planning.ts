import { type Tool, tool } from "ai";
import { z } from "zod";
import {
	applyTodos,
	isOpen,
	MAX_TODO_CHARS,
	MAX_TODOS,
	nextTodo,
	TODO_TOOL,
	type Todo,
} from "./todos";
import type { Mode } from "./tools";

/** Offers plan mode to the user (#771). Asks in every mode, never approved for the session. */
export const SUGGEST_PLAN = "suggest_plan_mode";
/** The agent recipe for plans and todos (read_doc path). */
export const PLAN_RECIPE = "agents/recipes/plan-and-todos";

/**
 * What a run knows about plans (#771). `mode` is the run's (the CLI changes it
 * when the user switches to plan). `approved`: the last run was plan mode and
 * this one is not, so the user approved the plan. `todos`: the list so far,
 * changed by update_todos. `wrote`: update_todos ran in this run.
 */
export type Planning = { mode: Mode; approved?: boolean; todos: Todo[]; wrote?: boolean };

/** update_todos is offered after a plan is approved and while the list has open items; never in plan mode. */
export const todosActive = (p: Planning) =>
	p.mode !== "plan" && (isOpen(p.todos) || (!!p.approved && !p.wrote));

const STATUS = z.enum(["pending", "in_progress", "done", "dropped"]);

export function planningTools(p: Planning): Record<string, Tool> {
	return {
		[SUGGEST_PLAN]: tool({
			title: "Suggest plan mode",
			description: `Your first call when a request needs several routes, workflows or other resources, spans more than one area, or is vague: asks the user to switch to plan mode. Not for one or two small changes. The user switches or says to go on; the result says which. More: read_doc ${PLAN_RECIPE}.`,
			inputSchema: z.object({
				reason: z.string().describe("One short sentence: why this needs a plan first"),
			}),
			// the approval answer sets the run's mode: plan when the user switched
			execute: async () =>
				p.mode === "plan"
					? "User switched to plan mode: look around with read tools and write the plan now. Change nothing until the user approves it."
					: "User chose to continue without a plan. Go on with the task.",
		}),
		[TODO_TOOL]: tool({
			title: "Update todo list",
			description: `Your todo list for the approved plan. items writes the whole list (main tasks, each with optional subtasks, one level; at most ${MAX_TODOS} items in all, ${MAX_TODO_CHARS} characters each). id with status marks one item (ids like "2" or "2.1"). A task with subtasks is done when they all are. One item in_progress at a time. Returns the whole list and the next task. How to use it: read_doc ${PLAN_RECIPE}.`,
			inputSchema: z.object({
				items: z
					.array(
						z.object({
							text: z.string(),
							status: STATUS.optional(),
							subtasks: z
								.array(z.object({ text: z.string(), status: STATUS.optional() }))
								.optional(),
						}),
					)
					.optional()
					.describe("The whole list; [] clears it"),
				id: z.string().optional().describe("The item to mark"),
				status: STATUS.optional().describe("Its new status"),
			}),
			execute: async (input) => {
				const next = applyTodos(p.todos, input);
				if (typeof next === "string") throw new Error(next);
				p.todos = next;
				p.wrote = true;
				return { todos: next, next: nextTodo(next) ?? null };
			},
		}),
	};
}
