import { describe, expect, test } from "bun:test";
import { parseSlash, SLASH_COMMANDS, slashSuggestions } from "./slashCommands";

describe("slash suggestions", () => {
	test("a lone / at the start suggests every command; a half name narrows them", () => {
		expect(slashSuggestions("/").map((c) => c.name)).toEqual(SLASH_COMMANDS.map((c) => c.name));
		expect(slashSuggestions("/co").map((c) => c.name)).toEqual(["compact"]);
		expect(slashSuggestions("/COMP").map((c) => c.name)).toEqual(["compact"]);
		expect(slashSuggestions("/compact").map((c) => c.name)).toEqual(["compact"]);
	});

	test("nothing once there is a space, other text or an unknown name", () => {
		for (const t of ["", "hello", "hello /", " /", "/compact ", "/compact keep", "/x", "/co mpact", "//"])
			expect(slashSuggestions(t)).toEqual([]);
	});
});

describe("parseSlash", () => {
	test("a command with and without text", () => {
		expect(parseSlash("/compact")).toMatchObject({ command: { name: "compact" }, args: "" });
		expect(parseSlash("  /compact  ")?.args).toBe("");
		expect(parseSlash("/compact keep the users table\nand the route ids")?.args).toBe(
			"keep the users table\nand the route ids",
		);
	});

	test("anything else is a plain message", () => {
		for (const t of ["hello", "/unknown", "/compactx", "a /compact", "/", "/ compact"])
			expect(parseSlash(t)).toBeUndefined();
	});
});
