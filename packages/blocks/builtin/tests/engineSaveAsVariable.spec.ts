import { describe, it, expect } from "bun:test";
import { JsVM } from "@fluxify/lib";
import { Engine } from "../../engine";
import { BaseBlock, BlockOutput, Context } from "../../baseBlock";

function createContext(): Context {
	const vars: Record<string, any> = {};
	return {
		vm: new JsVM(vars),
		route: "/test",
		apiId: "api-1",
		projectId: "proj-1",
		vars: vars as any,
		stopper: { timeoutEnd: 0, duration: 10000 },
	};
}

class OutputBlock extends BaseBlock {
	constructor(context: Context, private output: any, next?: string) {
		super(context, undefined, next);
	}
	async executeAsync(): Promise<BlockOutput> {
		return { successful: true, continueIfFail: true, output: this.output, next: this.next };
	}
}

describe("Engine save output to variable", () => {
	it("copies a block's output into the var it names, only for that block", async () => {
		const ctx = createContext();
		const first = new OutputBlock(ctx, { rows: [1, 2] }, "second");
		first.saveOutputAs = "rows";
		const second = new OutputBlock(ctx, "done");

		const result = await new Engine({ first, second }, { errorHandlerId: "", context: ctx }).start("first");

		expect(ctx.vars.outputs.rows).toEqual({ rows: [1, 2] });
		expect(Object.keys(ctx.vars)).toEqual(["outputs"]);
		expect(result!.output).toBe("done");
	});
});
