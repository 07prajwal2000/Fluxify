import { expect, test } from "bun:test";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import { BlockSettings, GENERAL_TAB, splitTabs } from "./BlockSettings";
import { blockSettingsTabs } from "./blockSettingsRegistry";
import type { BlockNode } from "../types";
import {
	CLOSE_DELTA_THRESHOLD,
	CLOSE_WIDTH_THRESHOLD,
	getStoredPanelWidth,
	setStoredPanelWidth,
} from "./useBlockPanelResize";

// bun has no DOM storage; the helpers only need get/setItem.
const store = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
	clear: () => store.clear(),
	key: (i: number) => [...store.keys()][i] ?? null,
	get length() {
		return store.size;
	},
} as Storage;

const { TabHead } = BlockSettings;

test("declared tabs become tabs, General ones are folded into the built-in tab", () => {
	const { generalExtras, blockTabs } = splitTabs([
		<TabHead key="g" name={GENERAL_TAB}>
			<span>extra</span>
		</TabHead>,
		<TabHead key="r" name="Request">
			<span>url</span>
		</TabHead>,
		<span key="stray">ignored</span>,
	]);

	expect(generalExtras).toHaveLength(1);
	expect(blockTabs.map((tab) => tab.props.name)).toEqual(["Request"]);
});

test("a block with no tabs still gets General only", () => {
	const { generalExtras, blockTabs } = splitTabs(undefined);
	expect(generalExtras).toHaveLength(0);
	expect(blockTabs).toHaveLength(0);
});

test("getvar, setvar, and transformer blocks have registered settings tabs", () => {
	const dummyGetVarBlock: BlockNode = {
		id: "getvar-1",
		type: BLOCK_TYPES.getvar,
		position: { x: 0, y: 0 },
		data: { key: "myVar" },
	};
	const dummySetVarBlock: BlockNode = {
		id: "setvar-1",
		type: BLOCK_TYPES.setvar,
		position: { x: 0, y: 0 },
		data: { key: "myVar", value: "js:123" },
	};
	const dummyTransformerBlock: BlockNode = {
		id: "transformer-1",
		type: BLOCK_TYPES.transformer,
		position: { x: 0, y: 0 },
		data: { useJs: false, fieldMap: { a: "b" } },
	};

	const getVarTabs = blockSettingsTabs(dummyGetVarBlock.type);
	const setVarTabs = blockSettingsTabs(dummySetVarBlock.type);
	const transformerTabs = blockSettingsTabs(dummyTransformerBlock.type);

	expect(getVarTabs).toBeDefined();
	expect(setVarTabs).toBeDefined();
	expect(transformerTabs).toBeDefined();

	const getVarResult = splitTabs(getVarTabs!(dummyGetVarBlock));
	expect(getVarResult.generalExtras).toHaveLength(1);

	const setVarResult = splitTabs(setVarTabs!(dummySetVarBlock));
	expect(setVarResult.generalExtras).toHaveLength(1);

	const transformerResult = splitTabs(transformerTabs!(dummyTransformerBlock));
	expect(transformerResult.generalExtras).toHaveLength(1);
	expect(transformerResult.blockTabs.map((tab) => tab.props.name)).toEqual(["Field Map"]);

	const dummyTransformerJsBlock: BlockNode = {
		id: "transformer-2",
		type: BLOCK_TYPES.transformer,
		position: { x: 0, y: 0 },
		data: { useJs: true, js: "return input;" },
	};
	const transformerJsResult = splitTabs(transformerTabs!(dummyTransformerJsBlock));
	expect(transformerJsResult.generalExtras).toHaveLength(1);
	expect(transformerJsResult.blockTabs.map((tab) => tab.props.name)).toEqual(["Custom JavaScript"]);
});

test("getStoredPanelWidth defaults correctly to 550px and respects 470px - 850px bounds", () => {
	const key = "test-panel-width-key-1";
	expect(getStoredPanelWidth(key, 550, 470, 850)).toBe(550);
});

test("setStoredPanelWidth and getStoredPanelWidth persist valid custom widths within 470px-850px", () => {
	const key = "test-panel-width-key-2";
	setStoredPanelWidth(650, key);
	expect(getStoredPanelWidth(key, 550, 470, 850)).toBe(650);

	// Below min (470px) falls back to default 550px
	setStoredPanelWidth(400, key);
	expect(getStoredPanelWidth(key, 550, 470, 850)).toBe(550);

	// Above max (850px) falls back to default 550px
	setStoredPanelWidth(950, key);
	expect(getStoredPanelWidth(key, 550, 470, 850)).toBe(550);
});

test("exports close thresholds of 450px target width and 120px delta", () => {
	expect(CLOSE_WIDTH_THRESHOLD).toBe(450);
	expect(CLOSE_DELTA_THRESHOLD).toBe(120);
});







