import { describe, expect, it } from "bun:test";
import {
	buildCanvasVariableSnippets,
	buildSetVarSnippets,
	buildVariableAccessSnippet,
	buildVariableAssignInputSnippet,
	buildVariableConditionalSnippet,
	buildVariableFallbackSnippet,
	buildVariableMergeSnippet,
} from "./variableSnippets";

describe("variableSnippets", () => {
	it("builds individual variable access snippet with direct identifier", () => {
		const snippet = buildVariableAccessSnippet("userId");
		expect(snippet.id).toBe("var-access-userId");
		expect(snippet.title).toBe("Access: userId");
		expect(snippet.category).toBe("variables");
		expect(snippet.code).toBe("const userId = userId;");
		expect(snippet.tags).toContain("userId");
	});

	it("handles special characters in variable names safely", () => {
		const snippet = buildVariableAccessSnippet("user-name");
		expect(snippet.id).toBe("var-access-user-name");
		expect(snippet.code).toBe("const user_name = user_name;");
	});

	it("builds fallback, assign-input, merge, and conditional snippets", () => {
		const fallback = buildVariableFallbackSnippet("token");
		expect(fallback.code).toBe('const token = token ?? "default_value";');

		const assign = buildVariableAssignInputSnippet("token");
		expect(assign.code).toBe("token = input?.token ?? input;");

		const merge = buildVariableMergeSnippet("profile");
		expect(merge.code).toContain("typeof profile === ");
		expect(merge.code).toContain("profile = { ...existing");

		const conditional = buildVariableConditionalSnippet("role");
		expect(conditional.code).toContain("if (input?.success)");
		expect(conditional.code).toContain("role = input.data;");
	});

	it("builds generic snippets when variableName is not specified", () => {
		const snippets = buildSetVarSnippets(undefined, []);
		expect(snippets.length).toBe(2);
		expect(snippets.some((s) => s.id === "var-access-generic")).toBe(true);
		expect(snippets.some((s) => s.id === "var-assign-input-generic")).toBe(true);
	});

	it("builds rich snippets when variableName is provided", () => {
		const snippets = buildSetVarSnippets("orderTotal");
		expect(snippets.length).toBe(5);
		expect(snippets.map((s) => s.id)).toEqual([
			"var-assign-input-orderTotal",
			"var-access-orderTotal",
			"var-fallback-orderTotal",
			"var-merge-orderTotal",
			"var-conditional-orderTotal",
		]);
	});

	it("includes other canvas variables and all-context-variables batch snippet", () => {
		const snippets = buildSetVarSnippets("currentItem", ["userId", "authToken"]);
		expect(snippets.length).toBe(8); // 5 for currentItem + 2 for others + 1 batch
		expect(snippets.some((s) => s.id === "var-context-userId")).toBe(true);
		expect(snippets.some((s) => s.id === "var-context-authToken")).toBe(true);

		const batch = snippets.find((s) => s.id === "var-context-all");
		expect(batch).toBeDefined();
		expect(batch?.code).toContain("const userId = userId;");
		expect(batch?.code).toContain("const authToken = authToken;");
	});

	it("deduplicates otherVariables against current variableName", () => {
		const snippets = buildSetVarSnippets("userId", ["userId", "authToken", "userId"]);
		expect(snippets.some((s) => s.id === "var-context-userId")).toBe(false);
		expect(snippets.some((s) => s.id === "var-context-authToken")).toBe(true);
	});

	it("builds simple canvas variable snippets with direct identifier", () => {
		const snippets = buildCanvasVariableSnippets(["user", "role", ""]);
		expect(snippets.length).toBe(2);
		expect(snippets[0].id).toBe("canvas-var-user");
		expect(snippets[0].code).toBe("const user = user;");
		expect(snippets[1].id).toBe("canvas-var-role");
		expect(snippets[1].code).toBe("const role = role;");
	});

	it("names the block a variable comes from, and every block when several write it", () => {
		const snippets = buildCanvasVariableSnippets([
			{ name: "users", source: "Fetch Users" },
			{ name: "users", source: "Load Cache" },
			{ name: "total" },
		]);
		expect(snippets.map((s) => s.description)).toEqual([
			'Read context variable "users" set by "Fetch Users", "Load Cache"',
			'Read context variable "total" from execution state',
		]);
	});

	it("follows a block rename into the snippet description", () => {
		const before = buildSetVarSnippets("x", [{ name: "res", source: "HTTP Request" }]);
		const after = buildSetVarSnippets("x", [{ name: "res", source: "Get Weather" }]);
		const find = (list: typeof before) => list.find((s) => s.id === "var-context-res");
		expect(find(before)?.description).toContain('"HTTP Request"');
		expect(find(after)?.description).toBe('Read context variable "res" set by "Get Weather"');
	});
});
