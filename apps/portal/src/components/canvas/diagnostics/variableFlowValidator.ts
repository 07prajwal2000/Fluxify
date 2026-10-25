import { BLOCK_TYPES } from "../blocks/blockTypes";
import { canvasVariables } from "../panel/SaveOutputField";
import { codeIn, withoutTextOrComments } from "../panel/scriptGlobals";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const VARIABLE_FLOW_SOURCE = "variable-flow";

type Data = Record<string, unknown>;
type Writers = Map<string, { ids: Set<string>; sources: Set<string> }>;

const escapeRegex = (name: string) => name.replace(/[$]/g, "\\$&");

/** Does the code read the global `name` (not `obj.name`, not one it declares itself)? */
function readsGlobal(code: string, name: string): boolean {
	const n = escapeRegex(name);
	if (!new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(code)) return false;
	return !new RegExp(`\\b(?:let|const|var|function|class)\\s+${n}(?![\\w$])`).test(code);
}

/** The names read as `outputs.<name>`. */
const outputsRead = (code: string) =>
	[...code.matchAll(/(?<![\w$.])outputs\s*\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

/** The names a Get Var block reads: its own key, or one per row. */
function getVarKeys(data: Data): string[] {
	const rows =
		data.mode === "multiple" && Array.isArray(data.items) ? (data.items as Data[]) : [data];
	return rows.map((row) => String(row?.key ?? "").trim()).filter(Boolean);
}

/**
 * Warns about a variable read where nothing has set it yet. Only what can be
 * said with the graph: a Get Var key, `outputs.<name>` and the names Set Var
 * writes. A read counts as "set" when some block that writes the name can run
 * before it; a name nothing on this canvas writes is only a note, since a
 * middleware may set it.
 */
export function validateVariableFlow(graph: CanvasGraph): BlockDiagnostic[] {
	const globals: Writers = new Map();
	const saved: Writers = new Map();
	for (const variable of canvasVariables(graph.blocks)) {
		if (!variable.id) continue;
		const writers = variable.output ? saved : globals;
		const entry = writers.get(variable.name) ?? { ids: new Set(), sources: new Set() };
		entry.ids.add(variable.id);
		entry.sources.add(variable.source);
		writers.set(variable.name, entry);
	}

	const wired = new Set(graph.edges.map((e) => e.to));
	const incoming = new Map<string, string[]>();
	for (const edge of graph.edges)
		incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
	const upstreamCache = new Map<string, Set<string>>();
	const upstream = (id: string) => {
		let seen = upstreamCache.get(id);
		if (!seen) {
			seen = new Set();
			const queue = [...(incoming.get(id) ?? [])];
			for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
				if (seen.has(next)) continue;
				seen.add(next);
				queue.push(...(incoming.get(next) ?? []));
			}
			upstreamCache.set(id, seen);
		}
		return seen;
	};

	const diagnostics: BlockDiagnostic[] = [];
	for (const block of graph.blocks) {
		// a block nothing leads to never runs, and the error handler is reached by a jump
		if (!wired.has(block.id) || block.type === BLOCK_TYPES.errorHandler) continue;
		const data = (block.data ?? {}) as Data;
		const warned = new Set<string>();
		const report = (
			key: string,
			label: string,
			writers: Writers,
			name: string,
			kind: "global" | "output",
		) => {
			if (warned.has(key)) return;
			const entry = writers.get(name);
			// a block reading what it writes itself, like a counter, is its own business
			if (entry?.ids.has(block.id)) return;
			if (!entry) {
				// scripts only look for names something writes; a Get Var or outputs read can name any
				if (kind === "global" && block.type !== BLOCK_TYPES.getvar) return;
				warned.add(key);
				diagnostics.push({
					blockId: block.id,
					severity: "info",
					message: `${label} is not set by any block on this canvas. That is fine if a middleware or an earlier step outside it sets it.`,
					source: VARIABLE_FLOW_SOURCE,
				});
				return;
			}
			const before = upstream(block.id);
			if ([...entry.ids].some((id) => before.has(id))) return;
			warned.add(key);
			const by = [...entry.sources].map((s) => `"${s}"`).join(", ");
			diagnostics.push({
				blockId: block.id,
				severity: "warning",
				message: `${label} is read here, but ${by} sets it and cannot have run yet: it is on a path after this block, or a different one.`,
				source: VARIABLE_FLOW_SOURCE,
			});
		};

		if (block.type === BLOCK_TYPES.getvar) {
			for (const name of getVarKeys(data)) {
				report(`g:${name}`, `Variable "${name}"`, globals, name, "global");
			}
		}
		for (const raw of codeIn(block.type, data)) {
			const code = withoutTextOrComments(raw);
			for (const name of outputsRead(code)) {
				report(`o:${name}`, `outputs.${name}`, saved, name, "output");
			}
			for (const name of globals.keys()) {
				if (readsGlobal(code, name))
					report(`g:${name}`, `Variable "${name}"`, globals, name, "global");
			}
		}
	}
	return diagnostics;
}
