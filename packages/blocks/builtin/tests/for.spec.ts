import { describe, expect, it, mock, vi } from "bun:test";
import { ForLoopBlock } from "../loops/for";
import { Engine } from "../../engine";
import { SetVarBlock } from "../setVar";
import { Context } from "../../baseBlock";
import { JsVM } from "@fluxify/lib";
import { InterceptorBlock } from "../interceptor";

describe("testing for loop block", () => {
	it("should call the callback n times", async () => {
		const n = 10;
		const sut = new ForLoopBlock(
			{} as any,
			{
				start: 0,
				blockDescription: "",
				blockName: "",
				end: n,
				step: 1,
			},
			{} as any,
		);
		let idx = 0;
		const callback = vi.fn((i) => {
			idx = i;
		});
		await sut.iterate(callback);
		expect(callback).toHaveBeenCalledTimes(n);
		expect(idx).toBe(n - 1);
	});
	it("should call the callback n times when start, end, step are script", async () => {
		const n = 10;
		const vars = { idx: 0 };
		const sut = new ForLoopBlock(
			{
				vm: new JsVM(vars) as any,
				route: "/users",
				apiId: "123",
				vars: {
					fruits: [],
				} as any,
				projectId: "",
				stopper: { duration: 30000, timeoutEnd: 0 },
			},
			{
				start: "js:return idx",
				end: n,
				step: 1,
				blockName: "",
				blockDescription: "",
			},
			{} as any,
		);
		let idx = 0;
		const callback = vi.fn((i) => {
			idx = i;
		});
		const result = await sut.iterate(callback);
		expect(result.successful).toBe(true);
		expect(callback).toHaveBeenCalledTimes(n);
		expect(idx).toBe(n - 1);
	});
	it("should run the block n times", async () => {
		const n = 5;
		const vars = { index: -1 };
		const context: Context = {
			vm: new JsVM(vars) as any,
			route: "/users",
			apiId: "123",
			vars: {
				fruits: [],
			} as any,
			projectId: "",
			stopper: { duration: 30000, timeoutEnd: 0 },
		};
		const mockFn = vi.fn();
		const engine = new Engine(
			{
				interceptor: new InterceptorBlock(context, "index_var_block", mockFn),
				index_var_block: new SetVarBlock(
					context,
					{
						key: "index",
						value: "js:return 0;",
						blockName: "",
						blockDescription: "",
					},
					undefined,
					false,
				),
			},
			{
				errorHandlerId: "",
				context,
			},
		);
		const sut = new ForLoopBlock(
			context,
			{
				block: "interceptor",
				start: 0,
				end: n,
				step: 1,
				blockName: "",
				blockDescription: "",
			},
			engine,
		);
		const result = await sut.executeAsync();
		expect(mockFn).toHaveBeenCalledTimes(n);
		expect(result.successful).toBe(true);
		expect(context.vars.index).toBeDefined();
	});

	// regression: the engine passes the previous block's output as executeAsync's
	// first argument. When that argument was the loop callback, any truthy value
	// threw "callback is not a function" — so an outer loop could never drive an
	// inner one (it hands down the index), and iteration 0 was the only one to run.
	it("should run a nested for loop for every outer iteration", async () => {
		const outer = 3;
		const inner = 4;
		const vars: Record<string, any> = { hits: 0 };
		const context: Context = {
			vm: new JsVM(vars) as any,
			route: "/nested",
			apiId: "123",
			vars: vars as any,
			projectId: "",
			stopper: { duration: 30000, timeoutEnd: 0 },
		};
		const bounds = { step: 1, blockName: "", blockDescription: "" };
		const count = vi.fn();

		const innerLoop = new ForLoopBlock(
			context,
			{ block: "counter", start: 0, end: inner, ...bounds },
			new Engine(
				{ counter: new InterceptorBlock(context, undefined, count) },
				{ errorHandlerId: "", context },
			),
		);
		const outerLoop = new ForLoopBlock(
			context,
			{ block: "inner", start: 0, end: outer, ...bounds },
			new Engine({ inner: innerLoop }, { errorHandlerId: "", context }),
		);

		const result = await outerLoop.executeAsync("a truthy output from a previous block");
		expect(result.successful).toBe(true);
		expect(count).toHaveBeenCalledTimes(outer * inner);
	});
});
