import { expect, test } from "bun:test";
import { blockToNode, nodeToBlock } from "../adapters";
import { splitChildren } from "./BaseBlock";
import {
	BLOCK_CATALOG,
	blockDefinition,
	canAddBlock,
	canPickBlock,
	pickerBlockCatalogEntries,
} from "./blockCatalog";
import { BLOCK_ICON_MAP } from "./blockIconMap";
import { blockLabels } from "./blockLabels";
import { createBlockNodeTypes } from "./BlockNode";
import { BLOCK_TYPES, BLOCK_TYPE_LIST } from "./blockTypes";
import { defaultBlockData } from "./defaultBlockData";
import { StickyNoteBlock } from "./StickyNoteBlock";
import { NOTE_MIN_SIZE, newStickyNoteData, stickyNoteData } from "./stickyNoteData";
import { BlockHandle } from "./handles/BlockHandle";
import { HANDLE_CONFIG, type HandleKind } from "./handles/handleConfig";

test("handles land on the rail their kind declares, other children stay in body", () => {
	const { rails, body } = splitChildren([
		<BlockHandle key="t" blockId="b1" kind="target" />,
		<BlockHandle key="s" blockId="b1" kind="source" />,
		<BlockHandle key="ok" blockId="b1" kind="success" />,
		<BlockHandle key="ex" blockId="b1" kind="executor" />,
		<span key="badge">3</span>,
	]);

	expect(rails.left).toHaveLength(1);
	expect(rails.right).toHaveLength(2);
	expect(rails.top).toHaveLength(1);
	expect(rails.bottom).toHaveLength(0);
	expect(body).toHaveLength(1);
});

test("every block type has an icon and a catalog entry", () => {
	for (const type of BLOCK_TYPE_LIST) {
		expect(BLOCK_ICON_MAP[type]).toBeTruthy();
		expect(BLOCK_CATALOG[type].name).toBeTruthy();
		expect(BLOCK_CATALOG[type].description).toBeTruthy();
	}
	// Unknown types still render rather than crashing the canvas.
	expect(blockDefinition("some_plugin_block").handles).toEqual(["target", "source"]);
});

test("route-owned blocks cannot be added from the canvas picker", () => {
	expect(canAddBlock(BLOCK_TYPES.entrypoint)).toBe(false);
	expect(canAddBlock(BLOCK_TYPES.errorHandler)).toBe(false);
	expect(canAddBlock(BLOCK_TYPES.response)).toBe(true);
	expect(pickerBlockCatalogEntries().map(([type]) => type)).not.toContain(
		BLOCK_TYPES.entrypoint,
	);
	expect(pickerBlockCatalogEntries().map(([type]) => type)).not.toContain(
		BLOCK_TYPES.errorHandler,
	);
	expect(canPickBlock(BLOCK_TYPES.stickynote)).toBe(false);
});

test("picker blocks start with their required data", () => {
	expect(defaultBlockData(BLOCK_TYPES.response)).toEqual({ httpCode: "200" });
	expect(defaultBlockData(BLOCK_TYPES.httprequest)).toEqual({
		url: "",
		method: "GET",
		headers: {},
		body: "",
		useParam: false,
	});
	expect(defaultBlockData(BLOCK_TYPES.db_insert)).toEqual({
		connection: "",
		tableName: "",
		data: { source: "raw", value: {} },
		useParam: false,
	});

	for (const [type] of pickerBlockCatalogEntries()) {
		const data = defaultBlockData(type);
		if (type === BLOCK_TYPES.httpgetrequestbody) {
			expect(data).toEqual({});
		} else {
			expect(Object.keys(data).length).toBeGreaterThan(0);
		}
	}
});

test("a block's own name wins over the catalog, placeholders do not", () => {
	const catalog = BLOCK_CATALOG[BLOCK_TYPES.consolelog];

	const named = blockLabels(BLOCK_TYPES.consolelog, {
		blockName: "Log the payload",
		blockDescription: "for debugging",
	});
	expect(named.name).toBe("Log the payload");
	expect(named.description).toBe("for debugging");
	expect(named.custom).toBe(true);

	// The server fills these defaults in for every block — they are not names.
	const placeholder = blockLabels(BLOCK_TYPES.consolelog, {
		blockName: "Name",
		blockDescription: "Description",
	});
	expect(placeholder.name).toBe(catalog.name);
	expect(placeholder.description).toBe(catalog.description);
	expect(placeholder.custom).toBe(false);

	expect(blockLabels(BLOCK_TYPES.consolelog).name).toBe(catalog.name);
	expect(blockLabels("some_plugin_block", { label: "Mine" }).name).toBe("Mine");
});

test("a note renders as its own resizable type with no sockets", () => {
	expect(createBlockNodeTypes()[BLOCK_TYPES.stickynote]).toBe(StickyNoteBlock);
	expect(BLOCK_CATALOG[BLOCK_TYPES.stickynote].handles).toEqual([]);
});

test("custom and unknown block types resolve to BlockNode automatically", () => {
	const nodeTypes = createBlockNodeTypes();
	expect(nodeTypes["my_custom_block"]).toBeDefined();
	expect(nodeTypes["my_custom_block"]).toBeTruthy();
});

test("note data is normalised into the shape the server validates", () => {
	// Empty data must still produce every required field.
	const fresh = stickyNoteData(undefined);
	expect(fresh.notes).toBe("");
	expect(fresh.color).toBe("yellow");
	expect(fresh.size).toEqual({ width: 180, height: 120 });

	expect(
		stickyNoteData({ notes: "# hi", color: "blue", size: { width: 90, height: 80 } }),
	).toEqual({ notes: "# hi", color: "blue", size: { width: 90, height: 80 } });

	// Notes can be arbitrarily large grouping layers; only invalid values reset.
	const fixed = stickyNoteData({
		notes: 12,
		color: "purple",
		size: { width: 4000, height: "nope" },
	});
	expect(fixed.notes).toBe("");
	expect(fixed.color).toBe("yellow");
	expect(fixed.size.width).toBe(4000);
	expect(fixed.size.height).toBe(fresh.size.height);
	expect(stickyNoteData({ size: { width: 1, height: 0 } }).size).toEqual({
		width: NOTE_MIN_SIZE,
		height: NOTE_MIN_SIZE,
	});
});

test("new notes start square without changing legacy note dimensions", () => {
	expect(newStickyNoteData().size).toEqual({ width: 180, height: 180 });
	expect(stickyNoteData({ size: { width: 180, height: 120 } }).size).toEqual({
		width: 180,
		height: 120,
	});
});

test("a loaded note is sized from its data and normalised", () => {
	const node = blockToNode({
		id: "n1",
		type: BLOCK_TYPES.stickynote,
		position: { x: 0, y: 0 },
		data: { notes: "hello" },
	});

	const data = stickyNoteData(node.data);
	expect(node.width).toBe(data.size.width);
	expect(node.height).toBe(data.size.height);
	expect(node.zIndex).toBe(-1);
	expect(data.color).toBe("yellow");
});

test("a resized note saves the box React Flow put on the node", () => {
	// Resizing from a top/left knob moves the node as well, so both must survive.
	const block = nodeToBlock({
		id: "n1",
		type: BLOCK_TYPES.stickynote,
		position: { x: 40, y: 10 },
		width: 150,
		height: 90,
		data: { notes: "hello", color: "green", size: { width: 180, height: 120 } },
	});

	expect(block.position).toEqual({ x: 40, y: 10 });
	expect(block.data).toEqual({
		notes: "hello",
		color: "green",
		size: { width: 150, height: 90 },
	});
});

test("only the inbound socket accepts multiple connections", () => {
	for (const [kind, config] of Object.entries(HANDLE_CONFIG) as [
		HandleKind,
		(typeof HANDLE_CONFIG)[HandleKind],
	][]) {
		if (kind === "target") {
			expect(config.flow).toBe("target");
			expect(config.maxConnections).toBeNull();
		} else {
			expect(config.flow).toBe("source");
			expect(config.maxConnections).toBe(1);
		}
	}
});
