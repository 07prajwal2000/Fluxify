import { describe, expect, it } from "bun:test";
import {
	createDefaultJsonRoot,
	createDefaultJsonValue,
	getJsonValueType,
	getUniqueObjectKey,
	moveArrayItem,
	renameObjectKey,
} from "./utils";

describe("JSON editor utilities", () => {
	it("identifies every JSON value type", () => {
		expect(getJsonValueType("value")).toBe("string");
		expect(getJsonValueType(3)).toBe("number");
		expect(getJsonValueType(false)).toBe("boolean");
		expect(getJsonValueType(null)).toBe("null");
		expect(getJsonValueType([])).toBe("array");
		expect(getJsonValueType({})).toBe("object");
	});

	it("creates independent defaults for collection types", () => {
		expect(createDefaultJsonValue("object")).toEqual({});
		expect(createDefaultJsonValue("array")).toEqual([]);
		expect(createDefaultJsonRoot("object")).toEqual({});
		expect(createDefaultJsonRoot("array")).toEqual([]);
	});

	it("generates a non-conflicting object key", () => {
		expect(getUniqueObjectKey({ key: null, key2: null })).toBe("key3");
	});

	it("renames a key in place and rejects collisions", () => {
		const source = { first: 1, second: 2 };
		expect(renameObjectKey(source, "first", "renamed")).toEqual({
			renamed: 1,
			second: 2,
		});
		expect(renameObjectKey(source, "first", "second")).toBe(source);
	});

	it("moves array items without mutating the source", () => {
		const source = ["a", "b", "c"];
		expect(moveArrayItem(source, 0, 2)).toEqual(["b", "c", "a"]);
		expect(source).toEqual(["a", "b", "c"]);
		expect(moveArrayItem(source, -1, 0)).toBe(source);
	});
});

