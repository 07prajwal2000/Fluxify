import { expect, test } from "bun:test";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import { handleId } from "../blocks/handles/handleConfig";
import type { BlockNode, CanvasBlock, CanvasEdge } from "../types";
import {
	createTransferDoc,
	decodeTransfer,
	encodeTransfer,
	toBase64,
	fromBase64,
	TRANSFER_VERSION,
	tryDecodeTransfer,
} from "./format";
import { prepareImport } from "./prepareImport";

const block = (id: string, type: string): CanvasBlock => ({
	id,
	type,
	position: { x: 0, y: 0 },
	data: { config: { message: "héllo — ✅\n" } },
});

const edge = (id: string, from: string, to: string): CanvasEdge => ({
	id,
	from,
	to,
	fromHandle: handleId(from, "source"),
	toHandle: handleId(to, "target"),
});

const node = (id: string, type: string): BlockNode => ({
	id,
	type,
	position: { x: 0, y: 0 },
	data: {},
});

test("base64 survives non-ascii and newlines", () => {
	const text = 'a "quoted" ✅ line\nwith é and 𝌆';
	expect(fromBase64(toBase64(text))).toBe(text);
});

test("a payload round-trips through encode/decode", () => {
	const doc = createTransferDoc(
		[block("a", "consolelog"), block("b", "consolelog")],
		[edge("e1", "a", "b")],
	);
	const decoded = decodeTransfer(encodeTransfer(doc));

	expect(decoded.version).toBe(TRANSFER_VERSION);
	expect(decoded.blocks.map((entry) => entry.id)).toEqual(["a", "b"]);
	expect(decoded.blocks[0].data).toEqual(doc.blocks[0].data);
	expect(decoded.edges).toEqual(doc.edges);
});

test("foreign and corrupted payloads are refused, not guessed at", () => {
	expect(tryDecodeTransfer("just some copied text")).toBeNull();
	expect(tryDecodeTransfer(toBase64('{"kind":"something.else"}'))).toBeNull();
	expect(tryDecodeTransfer(toBase64("{not json"))).toBeNull();
});

test("a payload from a newer version is refused", () => {
	const future = toBase64(
		JSON.stringify({
			...createTransferDoc([block("a", "consolelog")], []),
			version: TRANSFER_VERSION + 1,
		}),
	);
	expect(() => decodeTransfer(future)).toThrow(/newer version/i);
});

test("import reuses this canvas's entrypoint and error handler", () => {
	const doc = createTransferDoc(
		[
			block("old-entry", BLOCK_TYPES.entrypoint),
			block("old-error", BLOCK_TYPES.errorHandler),
			block("work", "consolelog"),
		],
		[edge("e1", "old-entry", "work"), edge("e2", "old-error", "work")],
	);
	const current = [
		node("entry-here", BLOCK_TYPES.entrypoint),
		node("error-here", BLOCK_TYPES.errorHandler),
	];

	const { part, reusedBlocks, skippedBlocks, droppedEdges } = prepareImport(
		doc,
		current,
	);

	// Only the real work is inserted — no second entrypoint or error handler.
	expect(part.nodes).toHaveLength(1);
	expect(part.nodes[0].id).not.toBe("work");
	expect(reusedBlocks).toBe(2);
	expect(skippedBlocks).toBe(0);
	expect(droppedEdges).toBe(0);

	// …and both connections now hang off the blocks already on this canvas.
	const [fromEntry, fromError] = part.edges;
	expect(fromEntry.source).toBe("entry-here");
	expect(fromEntry.sourceHandle).toBe(handleId("entry-here", "source"));
	expect(fromEntry.target).toBe(part.nodes[0].id);
	expect(fromError.source).toBe("error-here");
	expect(fromError.target).toBe(part.nodes[0].id);
});

test("connections to a block this canvas doesn't have are dropped", () => {
	const doc = createTransferDoc(
		[block("old-error", BLOCK_TYPES.errorHandler), block("work", "consolelog")],
		[edge("e1", "old-error", "work")],
	);

	const outcome = prepareImport(doc, [node("entry-here", BLOCK_TYPES.entrypoint)]);

	expect(outcome.part.nodes).toHaveLength(1);
	expect(outcome.part.edges).toEqual([]);
	expect(outcome.skippedBlocks).toBe(1);
	expect(outcome.droppedEdges).toBe(1);
});

test("an edge between two pre-existing blocks is not re-created", () => {
	const doc = createTransferDoc(
		[
			block("old-entry", BLOCK_TYPES.entrypoint),
			block("old-error", BLOCK_TYPES.errorHandler),
		],
		[edge("e1", "old-entry", "old-error")],
	);

	const outcome = prepareImport(doc, [
		node("entry-here", BLOCK_TYPES.entrypoint),
		node("error-here", BLOCK_TYPES.errorHandler),
	]);

	expect(outcome.part.nodes).toEqual([]);
	expect(outcome.part.edges).toEqual([]);
	expect(outcome.droppedEdges).toBe(1);
});

test("imported blocks get fresh ids and the requested offset", () => {
	const doc = createTransferDoc([block("work", "consolelog")], []);
	const { part } = prepareImport(doc, [], { offset: { x: 40, y: 20 }, select: true });

	expect(part.nodes[0].id).not.toBe("work");
	expect(part.nodes[0].position).toEqual({ x: 40, y: 20 });
	expect(part.nodes[0].selected).toBe(true);
});
