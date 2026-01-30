import { describe, expect, it, vi } from "vitest";
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
      {} as any
    );
    let idx = 0;
    const callback = vi.fn((i) => {
      idx = i;
    });
    await sut.executeAsync(callback);
    expect(callback).toHaveBeenCalledTimes(n);
    expect(idx).toBe(n - 1);
  });
  it("should call the callback n times when start, end, step are script", async () => {
    const n = 10;
    const vars = { idx: 0 };
    const sut = new ForLoopBlock(
      {
        apiId: "",
        route: "",
        vars: vars as any,
        vm: new JsVM(vars),
      },
      {
        start: "js:return idx",
        end: n,
        step: 1,
        blockName: "",
        blockDescription: "",
      },
      {} as any
    );
    let idx = 0;
    const callback = vi.fn((i) => {
      idx = i;
    });
    const result = await sut.executeAsync(callback);
    expect(result.successful).toBe(true);
    expect(callback).toHaveBeenCalledTimes(n);
    expect(idx).toBe(n - 1);
  });
  it("should run the block n times", async () => {
    const n = 5;
    const vars = { index: -1 };
    const context: Context = {
      apiId: "123",
      route: "/api/user",
      vars: vars as any,
      vm: new JsVM(vars),
    };
    const mockFn = vi.fn();
    const engine = new Engine({
      interceptor: new InterceptorBlock(context, "index_var_block", mockFn),
      index_var_block: new SetVarBlock(
        context,
        {
          key: "index",
          value: "js:return index;",
          blockName: "",
          blockDescription: "",
        },
        undefined,
        true
      ),
    }, "");
    const sut = new ForLoopBlock(
      context,
      {
        start: 0,
        end: n,
        step: 1,
        blockName: "interceptor",
        blockDescription: "",
      },
      engine
    );
    const result = await sut.executeAsync();
    expect(result.successful).toBe(true);
    expect(context.vars.index).toBeDefined();
  });
});
