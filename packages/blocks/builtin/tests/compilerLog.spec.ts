import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import { block, createContext, edge } from "./compilerTestHelpers";

describe("log blocks", () => {
	it("compiles a js: cloud log message without the vm", async () => {
		const { run, source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.cloudLogs, {
					connection: "obs-1",
					level: "warn",
					message: "js:return { id: input.id }",
				}),
			],
			[edge("1", "2")],
		);
		expect(source).not.toContain("ctx.vm");

		const logged: unknown[] = [];
		const ctx = createContext();
		ctx.integrationFactory = {
			create: () => ({ logWarn: (msg: unknown) => logged.push(msg) }),
		};
		await run(ctx, { id: 7 });
		expect(logged).toEqual([{ id: 7 }]);
	});
});
