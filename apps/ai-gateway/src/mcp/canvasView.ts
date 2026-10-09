import { blockAiDescriptions } from "@fluxify/blocks";
import { CODE_FIELDS } from "@fluxify/blocks/literalExpressions";
import { bare, edgeText } from "./canvasDraft";
import type { CanvasItems } from "./canvasNormalize";

/** What get_canvas returns, and what edit_canvas says about a block it adds. */

type Block = CanvasItems["blocks"][number];
type Edge = CanvasItems["edges"][number];
type Data = Record<string, unknown>;
type ViewBlock = { key: string; type: string; note?: string; data?: Data; summary?: string };

/** The note every new block starts with; it says nothing, so it is not shown. */
const PLACEHOLDER = "Description";
const MAX_NOTE = 400;
const MAX_VALUE = 40;
const MAX_SUMMARY = 200;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** What the block's author wrote about it; sticky notes are their own note. */
function noteOf(b: Block) {
	const data = (b.data ?? {}) as Data;
	const text = b.type === "sticky_note" ? data.notes : data.blockDescription;
	return typeof text === "string" && text.trim() && text !== PLACEHOLDER
		? cut(text.trim(), MAX_NOTE)
		: undefined;
}

/** One field as one short piece of text: code and `js:` become a line count, long text is cut. */
function show(isCode: boolean, value: unknown) {
	if (typeof value === "string") {
		const lines = count(value.split("\n").length, "line");
		if (isCode) return `code: ${lines}`;
		if (value.startsWith("js:")) return `js: ${lines}`;
		return JSON.stringify(cut(value, MAX_VALUE));
	}
	return cut(JSON.stringify(value) ?? String(value), MAX_VALUE);
}

function summarize(b: Block) {
	const data = (b.data ?? {}) as Data;
	const code = CODE_FIELDS[b.type];
	const parts = Object.entries(data)
		.filter(([k, v]) => k !== "blockDescription" && v !== undefined && v !== null && v !== "")
		.sort(([a], [z]) => Number(z === "blockName") - Number(a === "blockName"))
		.map(([k, v]) => `${k}=${show(k === code, v)}`);
	return cut(parts.join("; "), MAX_SUMMARY);
}

/** Without the note, which is shown beside the data instead. */
function withoutNote(b: Block) {
	const { blockDescription: _, ...data } = (b.data ?? {}) as Data;
	return data;
}

/**
 * What get_canvas returns: what the blocks do and how they connect, no UI
 * data. Blocks and edges are named by key, never by id.
 *
 * `compact`: per block only key, type, note and a one-line summary. `blocks`:
 * full data for just those keys, and the edges touching them.
 */
export function trimCanvas(
	canvas: CanvasItems & { canvasVersion: number },
	{ compact, blocks }: { compact?: boolean; blocks?: string[] } = {},
) {
	const keyOf = (b: Block) => b.key ?? b.id;
	const key = new Map(canvas.blocks.map((b) => [b.id, keyOf(b)]));
	const type = new Map(canvas.blocks.map((b) => [b.id, b.type]));
	let shown = canvas.blocks;
	if (blocks?.length) {
		shown = blocks.map((want) => {
			const found = canvas.blocks.find((b) => keyOf(b) === want || b.id === want);
			if (!found) {
				throw new Error(
					`get_canvas: no block "${want}". Keys: ${canvas.blocks.slice(0, 20).map(keyOf).join(", ")}.`,
				);
			}
			return found;
		});
	}
	const full = (b: Block): ViewBlock => ({
		key: keyOf(b),
		type: b.type,
		...(noteOf(b) ? { note: noteOf(b) } : {}),
		data: withoutNote(b),
	});
	const short = (b: Block): ViewBlock => ({
		key: keyOf(b),
		type: b.type,
		...(noteOf(b) ? { note: noteOf(b) } : {}),
		...(summarize(b) ? { summary: summarize(b) } : {}),
	});
	const ids = new Set(shown.map((b) => b.id));
	return {
		version: canvas.canvasVersion,
		blocks: shown.map(compact && !blocks?.length ? short : full),
		edges: canvas.edges
			.filter((e: Edge) => !blocks?.length || ids.has(e.from) || ids.has(e.to))
			.map((e: Edge) =>
				edgeText(
					key.get(e.from) ?? e.from,
					type.get(e.from) ?? "",
					bare(e.from, e.fromHandle ?? "source"),
					key.get(e.to) ?? e.to,
				),
			),
	};
}

/** What a built-in block hands the next one, so the contract shows up where it is added. */
export const declaredOutput = (type: string) => {
	const output = blockAiDescriptions.find((b) => b.name === type)?.output;
	return output ? cut(output, 300) : undefined;
};
