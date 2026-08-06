import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import type { EdgeDTOSchemaType } from "../../builderTypes";
import { block, createContext, edge } from "./compilerTestHelpers";

const edges: EdgeDTOSchemaType = [edge("1", "2"), edge("2", "3")];

describe("hoisted imports", () => {
	it("hoists imports out of user JS and runs them once", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, {
				value: [
					'import { randomUUID } from "node:crypto";',
					'import * as path from "node:path";',
					"return path.posix.join(typeof randomUUID(), input.dir);",
				].join("\n"),
			}),
			block("3", BlockTypes.response, { httpCode: "200" }),
		];

		const { run, source } = compileGraph(blocks, edges);
		// one load per module, at instantiation, outside every block function
		expect(source).toContain('await import("node:crypto")');
		expect(source.match(/await import\(/g)).toHaveLength(2);
		expect(source).not.toContain("import {");
		// nothing on the request path but a boolean once the loads have settled
		expect(source).toContain("if (!$importsReady) await $imports;");
		expect(source.indexOf("await import(")).toBeLessThan(source.indexOf("function $block_"));

		const result = await run(createContext(), { dir: "b" });
		expect(result.output.body).toBe("string/b");
	});

	it("imported names beat vars of the same name", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, {
				value: 'import path from "node:path";\nreturn typeof path.join;',
			}),
			block("3", BlockTypes.response, { httpCode: "200" }),
		];
		const ctx = createContext();
		ctx.vars.path = "not the module";
		const result = await compileGraph(blocks, edges).run(ctx, {});
		expect(result.output.body).toBe("function");
	});

	it("drops type-only imports and leaves lookalikes inside strings alone", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, {
				value: [
					'import type { Stats } from "node:fs";',
					'import { type Stats as S, basename } from "node:path";',
					"const snippet = `",
					'import nope from "does-not-exist";',
					"`;",
					"return basename(snippet.trim());",
				].join("\n"),
			}),
			block("3", BlockTypes.response, { httpCode: "200" }),
		];

		const { run, source } = compileGraph(blocks, edges);
		// only the value import survives — no node:fs, no type binding, no "does-not-exist"
		expect(source.match(/await import\(/g)).toHaveLength(1);
		expect(source).toContain('await import("node:path")');
		expect(source).toContain('let basename;');
		expect(source).toContain("does-not-exist"); // still inside the template literal

		const result = await run(createContext(), {});
		expect(result.output.body).toBe('import nope from "does-not-exist";');
	});

	it("rejects one name bound to two modules", () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, {
				value: 'import x from "node:path";\nimport x from "node:os";\nreturn x;',
			}),
			block("3", BlockTypes.response, { httpCode: "200" }),
		];
		expect(() => compileGraph(blocks, edges)).toThrow(/bound to both/);
	});

	it("refuses imports when user JS stays in the sandbox", () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, { value: 'import x from "node:os";\nreturn 1;' }),
			block("3", BlockTypes.response, { httpCode: "200" }),
		];
		expect(() => compileGraph(blocks, edges, { inlineJs: false })).toThrow(/inlined/);
	});
});
