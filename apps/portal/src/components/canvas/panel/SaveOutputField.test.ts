import { expect, test } from "bun:test";
import { blockLabels } from "../blocks/blockLabels";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import {
	canvasVariables,
	sanitizeVariableName,
	savesOutput,
} from "./SaveOutputField";

test("variable names drop invalid characters and leading digits as typed", () => {
	expect(sanitizeVariableName("my var-1")).toBe("myvar1");
	expect(sanitizeVariableName("12abc")).toBe("abc");
	expect(sanitizeVariableName("$_ok9")).toBe("$_ok9");
	expect(sanitizeVariableName("9")).toBe("");
});

test("only data-producing blocks and sync custom blocks offer the toggle", () => {
	expect(savesOutput(BLOCK_TYPES.httprequest, {})).toBe(true);
	expect(savesOutput(BLOCK_TYPES.db_getall, {})).toBe(true);
	expect(savesOutput(BLOCK_TYPES.setvar, {})).toBe(false);
	expect(savesOutput(BLOCK_TYPES.jsrunner, {})).toBe(false);
	expect(savesOutput("my_custom", {})).toBe(true);
	expect(savesOutput("my_custom", { invoke: "queued" })).toBe(false);
});

test("canvas variables include Set Var keys and enabled saved outputs, with their block", () => {
	const variables = canvasVariables([
		{ type: BLOCK_TYPES.setvar, data: { key: " total ", blockName: "Sum" } },
		{
			type: BLOCK_TYPES.httprequest,
			data: { blockName: "Get Weather", saveAsVariable: { enabled: true, name: "res" } },
		},
		{ type: BLOCK_TYPES.transformer, data: { saveAsVariable: { enabled: false, name: "off" } } },
		{ type: BLOCK_TYPES.jsrunner, data: { saveAsVariable: { enabled: true, name: "stale" } } },
	]);
	expect(variables).toEqual([
		{ name: "total", source: "Sum" },
		{ name: "res", source: "Get Weather" },
	]);
});

test("a block without a custom name is labelled by its default block name", () => {
	const [variable] = canvasVariables([
		{ type: BLOCK_TYPES.httprequest, data: { saveAsVariable: { enabled: true, name: "res" } } },
	]);
	expect(variable.source).toBe(blockLabels(BLOCK_TYPES.httprequest).name);
	expect(variable.source).not.toBe("");
});
