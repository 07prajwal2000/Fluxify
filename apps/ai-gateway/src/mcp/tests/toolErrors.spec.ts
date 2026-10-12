import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { formatFieldPath, formatIssues, formatPath, formatToolError, MAX_ISSUES } from "../toolErrors";

describe("formatPath", () => {
	it("reads keys with dots and array indices with brackets", () => {
		expect(formatPath(["keyName"])).toBe("keyName");
		expect(formatPath(["graph", "blocks", 3, "type"])).toBe("graph.blocks[3].type");
		expect(formatPath(["values", 0, "key"])).toBe("values[0].key");
	});

	it("names a root-level issue (root)", () => {
		expect(formatPath([])).toBe("(root)");
		expect(formatFieldPath("")).toBe("(root)");
	});

	it("turns the admin API's dotted field into brackets", () => {
		expect(formatFieldPath("values.0.key")).toBe("values[0].key");
		expect(formatFieldPath("name")).toBe("name");
	});
});

describe("formatIssues", () => {
	it("names each path and reason", () => {
		expect(
			formatIssues([
				{ path: ["values", 0, "key"], message: "Required" },
				{ path: ["graph", "blocks", 3, "type"], message: 'Invalid option: expected one of "a"|"b"' },
			]),
		).toBe('values[0].key: Required; graph.blocks[3].type: Invalid option: expected one of "a"|"b"');
	});

	it("keeps a long list short: first N and how many more", () => {
		const issues = Array.from({ length: MAX_ISSUES + 3 }, (_, i) => ({
			path: ["items", i],
			message: "Required",
		}));
		const text = formatIssues(issues);
		expect(text).toBe(
			`${Array.from({ length: MAX_ISSUES }, (_, i) => `items[${i}]: Required`).join("; ")}; and 3 more`,
		);
	});
});

describe("formatToolError", () => {
	it("reads a zod error's nested paths and reasons", () => {
		const schema = z.object({
			values: z.array(z.object({ key: z.string() })),
			graph: z.object({ blocks: z.array(z.object({ type: z.enum(["a", "b"]) })) }),
		});
		const result = schema.safeParse({ values: [{}], graph: { blocks: [{}, {}, {}, { type: "x" }] } });
		if (result.success) throw new Error("expected the parse to fail");
		const text = formatToolError(result.error) ?? "";
		expect(text).toContain("values[0].key: ");
		expect(text).toContain("graph.blocks[3].type: ");
	});

	it("reads an admin API validation body, brackets included", () => {
		const body = {
			type: "validation",
			errors: [
				{ field: "keyName", message: "Too small" },
				{ field: "values.0.key", message: "Required" },
			],
		};
		expect(formatToolError(body)).toBe("keyName: Too small; values[0].key: Required");
	});

	it("leaves an error without issues alone", () => {
		expect(formatToolError(new Error("boom"))).toBeUndefined();
		expect(formatToolError({ message: "nope" })).toBeUndefined();
	});
});
