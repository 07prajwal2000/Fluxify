import { afterEach, describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { compileGraph } from "../../compiler";
import {
	customBlockNames,
	hasCustomBlock,
	registerCustomBlock,
	unregisterCustomBlock,
} from "../customBlock";
import { block, createContext, edge } from "./compilerTestHelpers";

/** a worker serves many projects from one library; `createContext` is in `proj-1` */
const PROJECTS = ["proj-1", "proj-2"];

function greeting(projectId: string, answer: string) {
	registerCustomBlock(
		projectId,
		"greeting",
		[
			block("c1", BlockTypes.entrypoint),
			block("c2", BlockTypes.jsrunner, { value: `return '${answer}';` }),
		],
		[edge("c1", "c2")],
	);
}

function caller(projectId?: string) {
	return compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", "greeting" as BlockTypes),
			block("3", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("1", "2"), edge("2", "3")],
		{ projectId },
	);
}

afterEach(() => {
	for (const project of [...PROJECTS, "proj-3"]) {
		for (const name of customBlockNames(project)) unregisterCustomBlock(project, name);
	}
});

describe("custom blocks of different projects", () => {
	it("keeps blocks of the same name apart, resolving from the context", async () => {
		greeting("proj-1", "one");
		greeting("proj-2", "two");

		// one compiled caller, two projects: the call resolves its block at run time
		const { run } = caller("proj-1");
		expect((await run(createContext(), null)).output.body).toBe("one");
		expect((await run({ ...createContext(), projectId: "proj-2" }, null)).output.body).toBe("two");
	});

	it("unregisters only the project's own block", () => {
		greeting("proj-1", "one");
		greeting("proj-2", "two");

		unregisterCustomBlock("proj-1", "greeting");

		expect(hasCustomBlock("proj-1", "greeting")).toBe(false);
		expect(hasCustomBlock("proj-2", "greeting")).toBe(true);
		expect(customBlockNames("proj-2")).toEqual(["greeting"]);
	});

	it("never runs another project's block", async () => {
		greeting("proj-2", "two");

		// not a custom block to this project, so it has no code to emit
		expect(() => caller("proj-1")).toThrow("No codegen for block type: greeting");
		expect(() => caller()).toThrow("No codegen for block type: greeting");

		// and a caller compiled where the block exists fails rather than borrows
		const { run } = caller("proj-2");
		const result = await run({ ...createContext(), projectId: "proj-3" }, null);
		expect(result.successful).toBe(false);
	});
});
