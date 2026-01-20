import { beforeEach, describe, expect, it } from "vitest";
import { ArrayOperationsBlock } from "../arrayOperations";
import { Context } from "../../baseBlock";
import { JsVM } from "@fluxify/lib";

describe("Testing ArrayOperationsBlock", () => {
  describe("testing push operation", () => {
    let context: Context = {
      vm: {} as any,
      route: "/users",
      apiId: "123",
      vars: {
        fruits: [],
      } as any,
    };
    beforeEach(() => {
      context.vars.fruits = [];
    });
    it("should return true when everything is right", async () => {
      const sut = new ArrayOperationsBlock(
        context,
        {
          operation: "push",
          datasource: "fruits",
          value: "apple",
        },
        "123",
      );
      const result = await sut.executeAsync();
      expect(result.successful).toBe(true);
      expect(context.vars.fruits[context.vars.fruits.length - 1]).toBe("apple");
      expect(result.output!.includes("apple")).toBe(true);
    });
    it("should return true when element is passed via params", async () => {
      const sut = new ArrayOperationsBlock(
        context,
        {
          operation: "push",
          datasource: "fruits",
          useParamAsInput: true,
        },
        "123",
      );
      const result = await sut.executeAsync("apple");
      expect(result.successful).toBe(true);
      expect(context.vars.fruits[context.vars.fruits.length - 1]).toBe("apple");
      expect(result.output!.includes("apple")).toBe(true);
    });
    it("should return false when data is incorrect", async () => {
      const sut = new ArrayOperationsBlock(
        context,
        {
          operation: "push",
          datasource: "fruits",
          useParamAsInput: true,
        },
        "123",
      );
      const result = await sut.executeAsync();
      expect(result.successful).toBe(false);
      expect(context.vars.fruits.includes("apple")).toBe(false);
      expect(result.output).toBe(undefined);
    });
  });
  describe("testing pop operation", () => {
    let context: Context = {
      vm: {} as any,
      route: "/users",
      apiId: "123",
      vars: {
        fruits: [],
      } as any,
    };
    beforeEach(() => {
      context.vars.fruits = ["orange", "pineapple"];
    });
    it("should return true when everything is right", async () => {
      const sut = new ArrayOperationsBlock(
        context,
        {
          operation: "pop",
          datasource: "fruits",
        },
        "abcd",
      );
      const result = await sut.executeAsync();
      expect(result.successful).toBe(true);
      expect(context.vars.fruits.length).toBe(1);
      expect(context.vars.fruits[context.vars.fruits.length - 1]).toBe(
        "orange",
      );
      expect(result.output).toBeTruthy();
      expect(result.next?.trim()).toBeTruthy();
    });
    it("should return false when data is incorrect and no modification to array", async () => {
      const sut = new ArrayOperationsBlock(context, {
        operation: "pop",
        datasource: "fruity",
      });
      const result = await sut.executeAsync();
      expect(result.successful).toBe(false);
      expect(context.vars.fruits.length).toBe(2);
      expect(result.output).not.toBeTruthy();
    });
  });
  describe("testing shift operation", () => {
    let context: Context = {
      vm: {} as any,
      route: "/users",
      apiId: "123",
      vars: {
        fruits: [],
      } as any,
    };
    beforeEach(() => {
      context.vars.fruits = ["orange", "pineapple"];
    });
    it("should return true when everything is right", async () => {
      const sut = new ArrayOperationsBlock(
        context,
        {
          operation: "shift",
          datasource: "fruits",
        },
        "asdf",
      );
      const result = await sut.executeAsync();
      expect(result.successful).toBe(true);
      expect(context.vars.fruits.length).toBe(1);
      expect(context.vars.fruits[0]).toBe("pineapple");
      expect(Array.isArray(result.output)).toBe(true);
    });
    it("should return false when data is incorrect", async () => {
      const sut = new ArrayOperationsBlock(
        context,
        {
          operation: "shift",
          datasource: "fruit",
        },
        "asdf",
      );
      const result = await sut.executeAsync();
      expect(result.successful).toBe(false);
      expect(context.vars.fruits.length).toBe(2);
      expect(result.output).toBe(undefined);
    });
  });
  describe("testing unshift operation", () => {
    let context: Context = {
      vm: {} as any,
      route: "/users",
      apiId: "123",
      vars: {
        fruits: [],
      } as any,
    };
    beforeEach(() => {
      context.vars.fruits = [];
    });
    it("should return true when everything is right", async () => {
      const sut = new ArrayOperationsBlock(context, {
        operation: "unshift",
        datasource: "fruits",
        value: "apple",
      });
      const result = await sut.executeAsync();
      expect(result.successful).toBe(true);
      expect(context.vars.fruits[0]).toBe("apple");
      expect(result.output!.includes("apple")).toBe(true);
    });
    it("should return true when element is passed via params", async () => {
      const sut = new ArrayOperationsBlock(context, {
        operation: "unshift",
        datasource: "fruits",
        useParamAsInput: true,
      });
      const result = await sut.executeAsync("apple");
      expect(result.successful).toBe(true);
      expect(context.vars.fruits[0]).toBe("apple");
      expect(result.output!.includes("apple")).toBe(true);
    });
    it("should return false when data is incorrect", async () => {
      const sut = new ArrayOperationsBlock(context, {
        operation: "unshift",
        datasource: "fruits",
        useParamAsInput: true,
      });
      const result = await sut.executeAsync();
      expect(result.successful).toBe(false);
      expect(context.vars.fruits[0]).toBe(undefined);
      expect(result.output).toBe(undefined);
    });
  });
  describe("testing filter operation", () => {
    const vmContext = {};
    const vm = new JsVM(vmContext);
    let context: Context = {
      vm,
      route: "/users",
      apiId: "123",
      vars: {
        fruits: [],
      } as any,
    };
    beforeEach(() => {
      context.vars.fruits = ["pineapple", "orange"];
    });
    it("should return true when everything is right", async () => {
      const sut = new ArrayOperationsBlock(
        context,
        {
          operation: "filter",
          datasource: "fruits",
          filterConditions: [
            {
              lhs: "js:return input",
              rhs: "orange",
              operator: "eq",
              chain: "and",
            },
          ],
        },
        "asdf",
      );
      const result = await sut.executeAsync();
      expect(result.successful).toBe(true);
      expect(context.vars.fruits.length).toBe(1);
      expect(context.vars.fruits[0]).toBe("orange");
    });
  });
});
