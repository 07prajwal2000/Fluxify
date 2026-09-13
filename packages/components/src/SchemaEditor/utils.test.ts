import { describe, expect, test } from "bun:test";
import type { ValidationSchema } from "./types";
import {
	addPropertyAtPath,
	buildBreadcrumbs,
	findDuplicateKeys,
	getAtPath,
	getRuleValue,
	mergeAtPath,
	parseDefault,
	pathToKeyString,
	removeAtPath,
	updateRule,
} from "./utils";

const schema = (): ValidationSchema => ({
	dataType: "object",
	properties: [
		{ id: "a", key: "name", dataType: "str", rules: [] },
		{
			id: "b",
			key: "address",
			dataType: "object",
			properties: [{ id: "c", key: "zip", dataType: "str", rules: [] }],
		},
		{
			id: "d",
			key: "tags",
			dataType: "arr",
			items: { key: "", dataType: "str", rules: [] },
		},
	],
});

describe("path navigation", () => {
	test("reads nested properties and array items", () => {
		expect(getAtPath(schema(), [1, 0])).toMatchObject({ key: "zip" });
		expect(getAtPath(schema(), [2, "items"])).toMatchObject({ dataType: "str" });
		expect(getAtPath(schema(), [9])).toBeUndefined();
	});

	test("merging leaves untouched subtrees identical", () => {
		const before = schema();
		const after = mergeAtPath(before, [1, 0], { key: "postcode" });

		expect(getAtPath(after, [1, 0])).toMatchObject({ key: "postcode" });
		// The edit must not clone siblings, or memoised rows re-render for nothing.
		expect(after.properties?.[0]).toBe(before.properties![0]!);
		expect(before.properties?.[1]?.properties?.[0]?.key).toBe("zip");
	});

	test("creates the item schema on demand", () => {
		const bare: ValidationSchema = { dataType: "arr" };
		expect(mergeAtPath(bare, ["items"], { dataType: "int" }).items).toMatchObject(
			{ dataType: "int" },
		);
	});

	test("adds and removes at any depth", () => {
		const added = addPropertyAtPath(schema(), [1]);
		expect(added.properties?.[1]?.properties).toHaveLength(2);

		const removed = removeAtPath(schema(), [1, 0]);
		expect(removed.properties?.[1]?.properties).toHaveLength(0);

		const noItems = removeAtPath(schema(), [2, "items"]);
		expect(noItems.properties?.[2]?.items).toBeUndefined();
	});

	test("builds breadcrumbs and dotted keys", () => {
		expect(buildBreadcrumbs(schema(), [1, 0]).map((c) => c.title)).toEqual([
			"Main Schema",
			"address",
			"zip",
		]);
		expect(pathToKeyString(schema(), [1, 0])).toBe("address.zip");
		expect(pathToKeyString(schema(), [2, "items"])).toBe("tags[]");
	});
});

describe("duplicate keys", () => {
	test("flags repeats among siblings, ignoring blanks and whitespace", () => {
		const dupes = findDuplicateKeys([
			{ key: "name", dataType: "str", rules: [] },
			{ key: " name ", dataType: "int", rules: [] },
			{ key: "", dataType: "str", rules: [] },
			{ key: "", dataType: "str", rules: [] },
			{ key: "age", dataType: "int", rules: [] },
		]);
		expect([...dupes]).toEqual(["name"]);
	});
});

describe("rules", () => {
	test("upserts, and keeps falsy-but-real values", () => {
		let rules = updateRule([], "minLength", 3);
		expect(rules).toEqual([{ type: "minLength", value: 3 }]);

		rules = updateRule(rules, "minLength", 0);
		expect(getRuleValue<number | "">(rules, "minLength", "")).toBe(0);
	});

	test("an empty value deletes the rule rather than storing a blank bound", () => {
		const rules = updateRule([{ type: "max", value: 10 }], "max", "");
		expect(rules).toEqual([]);
		expect(getRuleValue(rules, "max", "unset")).toBe("unset");
	});

	test("enum values round-trip as a list", () => {
		const rules = updateRule([], "values", ["a", "b"]);
		expect(getRuleValue<string[]>(rules, "values", [])).toEqual(["a", "b"]);
	});
});

describe("parseDefault", () => {
	const prop = (dataType: any, rules: any[] = []) => ({ key: "k", dataType, rules });

	test("types the raw input per data type", () => {
		expect(parseDefault(prop("str"), "abc")).toBe("abc");
		expect(parseDefault(prop("int"), "10")).toBe(10);
		expect(parseDefault(prop("float"), "2.5")).toBe(2.5);
		expect(parseDefault(prop("bool"), "false")).toBe(false);
	});

	test("rejects values that are not valid for the type", () => {
		expect(parseDefault(prop("int"), "2.5")).toBeUndefined();
		expect(parseDefault(prop("int"), "abc")).toBeUndefined();
		expect(parseDefault(prop("float"), "-")).toBeUndefined();
		expect(parseDefault(prop("bool"), "yes")).toBeUndefined();
		expect(parseDefault(prop("str"), "")).toBeUndefined();
		expect(parseDefault(prop("object"), "{}")).toBeUndefined();
	});

	test("enum default keeps the allowed value's own type", () => {
		const perPage = prop("enum", [{ type: "values", value: [10, 25, 50] }]);
		expect(parseDefault(perPage, "25")).toBe(25);
		expect(parseDefault(perPage, "30")).toBeUndefined();
	});
});

describe("getAtPath on unsaved array items", () => {
	test("resolves the default item schema the navigator shows", () => {
		const root: ValidationSchema = { dataType: "arr" };
		expect(getAtPath(root, ["items"])).toEqual({ key: "", dataType: "str", rules: [] });
	});
});
