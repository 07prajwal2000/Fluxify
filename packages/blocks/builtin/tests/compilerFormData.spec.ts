import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import type { EdgeDTOSchemaType } from "../../builderTypes";
import { block, createContext, edge } from "./compilerTestHelpers";

/**
 * A compiled graph reading a parsed form body end to end. The unit tests prove
 * the transport produces `File` objects and plain fields; this proves the
 * compiled route can actually *use* them — the JS runner reads a file's bytes
 * inside the sandbox, and the branch/response blocks act on the result.
 */

/** the shape the multipart parser hands to `ctx.requestBody` */
function formBody(overrides: Record<string, unknown> = {}) {
	return {
		title: "Quarterly report",
		tags: ["finance", "q3"],
		report: new File(["net revenue up 4%"], "q3.txt", { type: "text/plain" }),
		...overrides,
	};
}

describe("compiled graph over a parsed form body", () => {
	it("reads fields and a file's contents, then branches on them", async () => {
		const blocks = [
			block("entry", BlockTypes.entrypoint),
			block("body", BlockTypes.httpGetRequestBody),
			block("read", BlockTypes.jsrunner, {
				value: `
					const report = input.report;
					return {
						title: input.title,
						tagCount: input.tags.length,
						fileName: report.name,
						// a part's type can carry parameters (text/plain;charset=utf-8)
						fileType: report.type.split(";")[0],
						fileSize: report.size,
						excerpt: (await report.text()).slice(0, 11),
					};
				`,
			}),
			block("guard", BlockTypes.if, {
				conditions: [
					{ lhs: "js:return input.fileSize", rhs: 0, operator: "gt", chain: "and" },
				],
			}),
			block("ok", BlockTypes.response, { httpCode: "200" }),
			block("empty", BlockTypes.response, { httpCode: "400" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("entry", "body"),
			edge("body", "read"),
			edge("read", "guard"),
			edge("guard", "ok", "success"),
			edge("guard", "empty", "failure"),
		];

		const { run, source } = compileGraph(blocks, edges);
		expect(source).toContain("ctx.requestBody");

		const ctx = createContext();
		ctx.requestBody = formBody();

		const result = await run(ctx, ctx.requestBody);

		expect(result.successful).toBe(true);
		expect(result.output).toEqual({
			httpCode: "200",
			body: {
				title: "Quarterly report",
				tagCount: 2,
				fileName: "q3.txt",
				fileType: "text/plain",
				fileSize: 17,
				excerpt: "net revenue",
			},
		});
	});

	it("takes the failure branch for an empty upload", async () => {
		const blocks = [
			block("entry", BlockTypes.entrypoint),
			block("body", BlockTypes.httpGetRequestBody),
			block("size", BlockTypes.jsrunner, { value: "return input.report.size;" }),
			block("guard", BlockTypes.if, {
				conditions: [{ lhs: "js:return input", rhs: 0, operator: "gt", chain: "and" }],
			}),
			block("ok", BlockTypes.response, { httpCode: "200" }),
			block("empty", BlockTypes.response, { httpCode: "400" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("entry", "body"),
			edge("body", "size"),
			edge("size", "guard"),
			edge("guard", "ok", "success"),
			edge("guard", "empty", "failure"),
		];

		const ctx = createContext();
		ctx.requestBody = formBody({ report: new File([], "empty.txt") });

		const { run } = compileGraph(blocks, edges);
		const result = await run(ctx, ctx.requestBody);

		expect(result.output).toEqual({ httpCode: "400", body: 0 });
	});

	it("stores an uploaded file in a var and a later block still reads its bytes", async () => {
		// vars survive between blocks by reference — a File must not be flattened
		// on the way through.
		const blocks = [
			block("entry", BlockTypes.entrypoint),
			block("body", BlockTypes.httpGetRequestBody),
			block("keep", BlockTypes.setvar, { key: "upload", value: "js:return input.report" }),
			block("later", BlockTypes.jsrunner, {
				value: "return (await upload.arrayBuffer()).byteLength;",
			}),
			block("out", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("entry", "body"),
			edge("body", "keep"),
			edge("keep", "later"),
			edge("later", "out"),
		];

		const ctx = createContext();
		ctx.requestBody = formBody();

		const { run } = compileGraph(blocks, edges);
		const result = await run(ctx, ctx.requestBody);

		expect(ctx.vars.upload).toBeInstanceOf(File);
		expect(result.output).toEqual({ httpCode: "200", body: 17 });
	});

	it("iterates the repeated fields a form produced", async () => {
		const blocks = [
			block("entry", BlockTypes.entrypoint),
			block("body", BlockTypes.httpGetRequestBody),
			block("pick", BlockTypes.jsrunner, { value: "return input.tags;" }),
			// the loop consumes the flowing value; results accumulate in a var
			block("loop", BlockTypes.foreachloop, { values: [], useParam: true }),
			block("upper", BlockTypes.jsrunner, {
				value: "seen = (seen || []); seen.push(input.toUpperCase()); return input;",
			}),
			block("collect", BlockTypes.getvar, { key: "seen" }),
			block("out", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("entry", "body"),
			edge("body", "pick"),
			edge("pick", "loop"),
			edge("loop", "upper", "executor"),
			edge("loop", "collect"),
			edge("collect", "out"),
		];

		const ctx = createContext();
		ctx.requestBody = formBody();

		const { run } = compileGraph(blocks, edges);
		const result = await run(ctx, ctx.requestBody);

		expect(result.output).toEqual({
			httpCode: "200",
			body: ["FINANCE", "Q3"],
		});
	});
});
