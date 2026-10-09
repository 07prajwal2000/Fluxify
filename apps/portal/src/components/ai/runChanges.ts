import type { AgentRow } from "@/services/agentConversations";
import { type ChatMessage, toMessages } from "./agentMessages";
import type { RefType } from "./agentRefs";

export type Change = {
	type: RefType;
	id: string;
	label: string;
	action: "created" | "updated" | "deleted";
};

/** Tool → the resource it saves, the input field holding its id, and the fields that name it. */
const SAVES: Record<string, [RefType, string, string[]]> = {
	save_route: ["route", "routeId", ["name", "path"]],
	save_workflow: ["workflow", "workflowId", ["name"]],
	save_trigger: ["trigger", "triggerId", ["name"]],
	save_custom_block: ["custom_block", "customBlockId", ["label", "name"]],
	save_middleware: ["middleware", "middlewareId", ["name"]],
	save_integration: ["integration", "integrationId", ["name"]],
	save_app_config: ["app_config", "appConfigId", ["keyName"]],
	save_test_suite: ["test_suite", "testSuiteId", ["name"]],
};
const DELETES: Record<string, [RefType, string]> = {
	delete_route: ["route", "routeId"],
	delete_workflow: ["workflow", "workflowId"],
	delete_trigger: ["trigger", "triggerId"],
	delete_custom_block: ["custom_block", "customBlockId"],
	delete_middleware: ["middleware", "middlewareId"],
	delete_integration: ["integration", "integrationId"],
	delete_app_config: ["app_config", "appConfigId"],
	delete_test_suite: ["test_suite", "testSuiteId"],
};
const CANVAS_KINDS: Record<string, RefType> = {
	route: "route",
	workflow: "workflow",
	custom_block: "custom_block",
};

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * What a run created, updated and deleted, from its successful tool calls.
 * Names come from the saves that carry one, in `all` (the whole conversation, so
 * a resource made in an earlier run keeps its name); an update that changes only
 * a field falls back to the type and a short id.
 */
export function changesOf(run: ChatMessage[], all: ChatMessage[] = run): Change[] {
	const names = new Map<string, string>();
	for (const m of all)
		for (const p of m.parts) {
			const save = p.type === "tool" && p.error === undefined ? SAVES[p.name] : undefined;
			if (p.type !== "tool" || !save) continue;
			const id = str(rec(p.output).id) || str(rec(p.input)[save[1]]);
			const name = save[2].map((k) => str(rec(p.input)[k])).find(Boolean);
			if (id && name) names.set(`${save[0]}:${id}`, name);
		}
	const label = (type: RefType, id: string) =>
		names.get(`${type}:${id}`) ?? `${type.replace("_", " ")} ${id.slice(0, 8)}`;

	const seen = new Map<string, Change>();
	// created then updated stays created; a later delete wins
	const add = (type: RefType, id: string, action: Change["action"]) => {
		const was = seen.get(`${type}:${id}`);
		seen.set(`${type}:${id}`, {
			type,
			id,
			label: label(type, id),
			action: action === "updated" && was && was.action !== "deleted" ? was.action : action,
		});
	};
	for (const m of run)
		for (const p of m.parts) {
			if (p.type !== "tool" || p.error !== undefined || p.output === undefined) continue;
			const input = rec(p.input);
			const save = SAVES[p.name];
			const del = DELETES[p.name];
			if (save) {
				const given = str(input[save[1]]);
				const id = given || str(rec(p.output).id);
				if (id) add(save[0], id, given ? "updated" : "created");
			} else if (del) {
				const id = str(input[del[1]]);
				if (id) add(del[0], id, "deleted");
			} else if (p.name === "edit_canvas") {
				const t = rec(input.target);
				const type = CANVAS_KINDS[str(t.kind)];
				if (type && str(t.id)) add(type, str(t.id), "updated");
			}
		}
	return [...seen.values()];
}

/** The changes of one run, out of the saved rows of its conversation. */
export const runChanges = (rows: AgentRow[], runId: string) =>
	changesOf(toMessages(rows.filter((r) => r.runId === runId)), toMessages(rows));

export const fmtTokens = (n: number) =>
	n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString("en-US");

export function fmtDuration(ms: number) {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
