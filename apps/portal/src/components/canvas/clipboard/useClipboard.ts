import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "@fluxify/components";
import { flowToGraph } from "../adapters";
import {
	CanvasTransferError,
	createTransferDoc,
	downloadTransfer,
	encodeTransfer,
	pickTransferFile,
	prepareImport,
	readTransferFile,
	transferFilename,
	tryDecodeTransfer,
	type CanvasTransferDoc,
	type PreparedImport,
} from "../transfer";
import type { BlockEdge, BlockNode } from "../types";
import { pickGraphPart, type GraphPart } from "./cloneGraphPart";

/** How far each paste/duplicate lands from the original, in graph units. */
export const PASTE_OFFSET = { x: 32, y: 32 };

export type CopyResult = {
	/** Blocks taken. `0` means there was nothing to copy. */
	count: number;
	/** Encoded payload, or `null` when nothing was copied. */
	text: string | null;
};

export type CanvasClipboard = {
	enabled: boolean;
	/** True once something has been copied — for enabling a paste button. */
	canPaste: boolean;
	/** Copies the given blocks, or the selection when called with nothing. Also
	 *  writes the encoded payload to the system clipboard, best effort. */
	copy: (blockIds?: Iterable<string>) => CopyResult;
	/** Pastes the system clipboard, falling back to the last local copy. */
	paste: () => Promise<void>;
	/** Pastes text already read for us (a native `paste` event). Returns whether
	 *  the text was one of our payloads. */
	pasteText: (text: string) => boolean;
	/** Copy + paste in one step, without touching the clipboard. */
	duplicate: (blockIds: Iterable<string>) => void;
	/** Downloads the given blocks (or the selection) as a versioned file. */
	exportSelection: (blockIds?: Iterable<string>) => number;
	/** Opens the file picker and imports what the user chooses. */
	importFromFile: () => Promise<void>;
};

export type UseClipboardOptions = {
	enabled: boolean;
	/** Reads the live graph — a ref read, so the callbacks stay stable. */
	getGraph: () => { nodes: BlockNode[]; edges: BlockEdge[] };
	/** Adds the clones to the canvas (history, tracking and state are its job). */
	insert: (part: GraphPart) => void;
};

/** One line covering what the import had to leave out, or `null` when clean. */
function describeImport(outcome: PreparedImport): string | null {
	const notes: string[] = [];
	if (outcome.reusedBlocks > 0) {
		notes.push(
			`${outcome.reusedBlocks} entry/error block(s) reconnected to this canvas`,
		);
	}
	if (outcome.skippedBlocks > 0) notes.push(`${outcome.skippedBlocks} skipped`);
	if (outcome.droppedEdges > 0) {
		notes.push(`${outcome.droppedEdges} connection(s) dropped`);
	}
	return notes.length > 0 ? notes.join(", ") : null;
}

/**
 * Copy, paste, duplicate, export and import over graph slices.
 *
 * Everything leaving the canvas goes through the versioned transfer format, so
 * a slice copied today still pastes into a later build — and a payload from a
 * build we don't understand is refused instead of half-applied. The in-memory
 * copy is kept as a fallback for browsers that won't hand us clipboard text.
 */
export function useClipboard({
	enabled,
	getGraph,
	insert,
}: UseClipboardOptions): CanvasClipboard {
	const held = useRef<CanvasTransferDoc | null>(null);
	const [canPaste, setCanPaste] = useState(false);
	// Repeated pastes of the same slice must not stack on top of each other.
	const pastes = useRef(0);
	const lastPayload = useRef<string | null>(null);

	/** The selection (or the given blocks) as a transfer document. */
	const readPart = useCallback(
		(blockIds?: Iterable<string>): CanvasTransferDoc | null => {
			const { nodes, edges } = getGraph();
			const part = pickGraphPart(nodes, edges, blockIds);
			if (part.nodes.length === 0) return null;
			const graph = flowToGraph(part.nodes, part.edges);
			return createTransferDoc(graph.blocks, graph.edges);
		},
		[getGraph],
	);

	const insertDoc = useCallback(
		(doc: CanvasTransferDoc, step: number) => {
			const outcome = prepareImport(doc, getGraph().nodes, {
				offset: { x: PASTE_OFFSET.x * step, y: PASTE_OFFSET.y * step },
				select: true,
			});
			if (outcome.part.nodes.length === 0) {
				toast.danger("Nothing to add — every block in that payload already exists here.");
				return;
			}
			insert(outcome.part);
			const note = describeImport(outcome);
			if (note) toast.warning(`Added ${outcome.part.nodes.length} block(s): ${note}`);
		},
		[getGraph, insert],
	);

	const copy = useCallback(
		(blockIds?: Iterable<string>): CopyResult => {
			if (!enabled) return { count: 0, text: null };
			const doc = readPart(blockIds);
			held.current = doc;
			pastes.current = 0;
			setCanPaste(!!doc);
			if (!doc) return { count: 0, text: null };
			const text = encodeTransfer(doc);
			lastPayload.current = text;
			// Best effort: a denied permission or an insecure origin must not break
			// copying — the in-memory document still backs paste.
			void navigator.clipboard?.writeText(text).catch(() => {});
			return { count: doc.blocks.length, text };
		},
		[enabled, readPart],
	);

	/** Shared by every paste route: same payload again = keep stepping away. */
	const applyPayload = useCallback(
		(doc: CanvasTransferDoc, text: string | null) => {
			if (text && text === lastPayload.current) pastes.current += 1;
			else {
				lastPayload.current = text;
				pastes.current = 1;
			}
			insertDoc(doc, pastes.current);
		},
		[insertDoc],
	);

	const pasteText = useCallback(
		(text: string) => {
			if (!enabled) return false;
			const doc = tryDecodeTransfer(text);
			if (!doc) return false;
			applyPayload(doc, text);
			return true;
		},
		[enabled, applyPayload],
	);

	const paste = useCallback(async () => {
		if (!enabled) return;
		// Firefox has no readText for web pages, and a denied permission throws —
		// either way the last local copy is the answer, not an error.
		let text: string | null = null;
		try {
			text = (await navigator.clipboard?.readText()) ?? null;
		} catch {
			text = null;
		}
		if (text && pasteText(text)) return;
		if (held.current) applyPayload(held.current, lastPayload.current);
	}, [enabled, pasteText, applyPayload]);

	const duplicate = useCallback(
		(blockIds: Iterable<string>) => {
			if (!enabled) return;
			const doc = readPart(blockIds);
			if (doc) insertDoc(doc, 1);
		},
		[enabled, readPart, insertDoc],
	);

	const exportSelection = useCallback(
		(blockIds?: Iterable<string>) => {
			const doc = readPart(blockIds);
			if (!doc) {
				toast.danger("Select at least one block to export.");
				return 0;
			}
			downloadTransfer(encodeTransfer(doc), transferFilename(doc.blocks.length));
			return doc.blocks.length;
		},
		[readPart],
	);

	const importFromFile = useCallback(async () => {
		if (!enabled) return;
		const file = await pickTransferFile();
		if (!file) return;
		try {
			insertDoc(await readTransferFile(file), 0);
		} catch (error) {
			toast.danger(
				error instanceof CanvasTransferError
					? error.message
					: "Couldn't read that file.",
			);
		}
	}, [enabled, insertDoc]);

	return useMemo(
		() => ({
			enabled,
			canPaste: enabled && canPaste,
			copy,
			paste,
			pasteText,
			duplicate,
			exportSelection,
			importFromFile,
		}),
		[
			enabled,
			canPaste,
			copy,
			paste,
			pasteText,
			duplicate,
			exportSelection,
			importFromFile,
		],
	);
}
