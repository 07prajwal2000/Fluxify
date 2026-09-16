import { describe, expect, it } from "bun:test";
import { defaultBlockData } from "../blocks/defaultBlockData";
import { BLOCK_TYPES, type BlockType } from "../blocks/blockTypes";
import { blockConfigIssues, validateBlockConfigs } from "./blockConfigValidator";

const graph = (type: BlockType, data: Record<string, unknown>, wired = true) => ({
	blocks: [{ id: "b", type, data, position: { x: 0, y: 0 } }],
	edges: wired ? [{ id: "e", from: "a", to: "b", fromHandle: "a-next", toHandle: "b-prev" }] : [],
});
const severities = (type: BlockType, data: Record<string, unknown>) =>
	blockConfigIssues(type, data).map((i) => i.severity);

describe("validateBlockConfigs", () => {
	it("ignores blocks with no incoming connection", () => {
		expect(validateBlockConfigs(graph(BLOCK_TYPES.db_getall, defaultBlockData(BLOCK_TYPES.db_getall), false))).toEqual([]);
	});

	it("flags a fresh db get all: connection, table, no conditions", () => {
		expect(severities(BLOCK_TYPES.db_getall, defaultBlockData(BLOCK_TYPES.db_getall))).toEqual(["error", "error", "warning"]);
	});

	it("flags empty condition sides and incomplete joins", () => {
		const data = {
			connection: "c",
			tableName: "t",
			conditions: [{ attribute: { kind: "column", value: "id" }, value: { kind: "literal", value: "" } }],
			joins: [{ type: "inner", table: "", attribute: "x" }],
			limit: 10,
			offset: 0,
		};
		expect(blockConfigIssues(BLOCK_TYPES.db_getall, data)).toHaveLength(2);
	});

	it("flags invalid save-output names", () => {
		const data = { url: "https://x.dev", saveAsVariable: { enabled: true, name: "" } };
		expect(severities(BLOCK_TYPES.httprequest, data)).toEqual(["error"]);
	});

	it("checks http url and body", () => {
		expect(severities(BLOCK_TYPES.httprequest, { url: "nope" })).toEqual(["error"]);
		expect(severities(BLOCK_TYPES.httprequest, { url: "js: return u" })).toEqual([]);
		expect(severities(BLOCK_TYPES.httprequest, { url: "https://x.dev", method: "POST", body: "" })).toEqual(["warning"]);
		expect(severities(BLOCK_TYPES.httprequest, { url: "https://x.dev", method: "POST", useParam: true })).toEqual([]);
	});

	it("detects infinite for loops only for numeric values", () => {
		expect(severities(BLOCK_TYPES.forloop, { start: 0, end: 10, step: 0 })).toEqual(["warning"]);
		expect(severities(BLOCK_TYPES.forloop, { start: "10", end: "0", step: "1" })).toEqual(["warning"]);
		expect(severities(BLOCK_TYPES.forloop, { start: 0, end: 10, step: 1 })).toEqual([]);
		expect(severities(BLOCK_TYPES.forloop, { start: 0, end: "js: return n", step: -1 })).toEqual([]);
	});

	it("needs 6+ char scripts", () => {
		expect(severities(BLOCK_TYPES.jsrunner, { value: "ret" })).toEqual(["warning"]);
		expect(severities(BLOCK_TYPES.jsrunner, { value: "return" })).toEqual([]);
		expect(severities(BLOCK_TYPES.transformer, { useJs: false, fieldMap: {} })).toEqual(["warning"]);
		expect(severities(BLOCK_TYPES.transformer, { useJs: true, js: "return 1" })).toEqual([]);
	});

	it("respects use param toggles", () => {
		expect(severities(BLOCK_TYPES.arrayops, { useParamAsInput: true })).toEqual([]);
		expect(severities(BLOCK_TYPES.arrayops, { useParamAsInput: false })).toEqual(["warning"]);
		expect(severities(BLOCK_TYPES.foreachloop, { useParam: false, values: [] })).toEqual(["warning"]);
		expect(severities(BLOCK_TYPES.foreachloop, { useParam: true, values: [] })).toEqual([]);
	});

	it("reports an orchestrator with no branches as info", () => {
		expect(validateBlockConfigs(graph(BLOCK_TYPES.orchestrator, {})).map((d) => d.severity)).toEqual(["info"]);
	});
});
