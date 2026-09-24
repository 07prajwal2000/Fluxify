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
});

describe("project packages (#477)", () => {
	const graph = (code: string) => [
		block("1", BlockTypes.entrypoint),
		block("2", BlockTypes.jsrunner, { value: code }),
		block("3", BlockTypes.response, { httpCode: "200" }),
	];

	it("resolves a package from the project's deps dir, leaves builtins alone", async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const root = mkdtempSync(join(tmpdir(), "deps-"));
		const pkg = join(root, "p1", "current", "node_modules", "fake-pkg");
		mkdirSync(pkg, { recursive: true });
		writeFileSync(join(pkg, "package.json"), '{"name":"fake-pkg","main":"index.js"}');
		writeFileSync(join(pkg, "index.js"), "module.exports = { hello: () => 'from deps' };");

		const before = process.env.FLUXIFY_DEPS_DIR;
		process.env.FLUXIFY_DEPS_DIR = root;
		try {
			const { run, source } = compileGraph(
				graph('import fake from "fake-pkg";\nimport { createHash } from "crypto";\nreturn fake.hello() + typeof createHash;'),
				edges,
				{ dependencies: { projectId: "p1", packages: ["fake-pkg"] } },
			);
			expect(source).toContain('Bun.resolveSync("fake-pkg"');
			expect(source).toContain('await import("crypto")');
			const result = await run(createContext(), {});
			expect(result.output.body).toBe("from depsfunction");
		} finally {
			if (before === undefined) delete process.env.FLUXIFY_DEPS_DIR;
			else process.env.FLUXIFY_DEPS_DIR = before;
		}
	});

	it("refuses a package the project has not installed", () => {
		expect(() =>
			compileGraph(graph('import _ from "lodash/fp";\nreturn 1;'), edges, {
				dependencies: { projectId: "p1", packages: ["other"] },
			}),
		).toThrow('Package "lodash" is not installed');
	});
});
