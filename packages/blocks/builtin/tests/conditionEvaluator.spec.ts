import { describe, it, expect, beforeEach } from "bun:test";
import { ConditionEvaluator, OperatorResult } from "../conditionEvaluator";
import { JsVM } from "@fluxify/lib";

describe("ConditionEvaluator", () => {
  describe("evaluateResult()", () => {
    it("should return true for all TRUE results", () => {
      expect(
        ConditionEvaluator.evaluateResult([
          OperatorResult.TRUE,
          OperatorResult.TRUE,
          OperatorResult.TRUE,
        ]),
      ).toBe(true);
    });

    it("should return false for all FALSE results", () => {
      expect(
        ConditionEvaluator.evaluateResult([
          OperatorResult.FALSE,
          OperatorResult.FALSE,
        ]),
      ).toBe(false);
    });

    it("should return true when one AND group is all true with OR separation", () => {
      // (TRUE AND FALSE) OR (TRUE) => false OR true => true
      expect(
        ConditionEvaluator.evaluateResult([
          OperatorResult.TRUE,
          OperatorResult.FALSE,
          OperatorResult.OR,
          OperatorResult.TRUE,
        ]),
      ).toBe(true);
    });

    it("should return false when no AND group is fully true", () => {
      // (TRUE AND FALSE) OR (FALSE) => false OR false => false
      expect(
        ConditionEvaluator.evaluateResult([
          OperatorResult.TRUE,
          OperatorResult.FALSE,
          OperatorResult.OR,
          OperatorResult.FALSE,
        ]),
      ).toBe(false);
    });

    it("should handle trailing OR correctly", () => {
      expect(
        ConditionEvaluator.evaluateResult([
          OperatorResult.TRUE,
          OperatorResult.OR,
        ]),
      ).toBe(true);
      expect(
        ConditionEvaluator.evaluateResult([
          OperatorResult.FALSE,
          OperatorResult.OR,
        ]),
      ).toBe(false);
    });
  });

  describe("evaluateOperator()", () => {
    const vm = new JsVM({ status: "active" });

    it("should evaluate eq operator correctly", async () => {
      expect(await ConditionEvaluator.evaluateOperator(1, 1, "eq", vm)).toBe(
        true,
      );
      expect(
        await ConditionEvaluator.evaluateOperator("a", "a", "eq", vm),
      ).toBe(true);
      expect(await ConditionEvaluator.evaluateOperator(1, 2, "eq", vm)).toBe(
        false,
      );
    });

    it("should evaluate neq operator correctly", async () => {
      expect(await ConditionEvaluator.evaluateOperator(1, 2, "neq", vm)).toBe(
        true,
      );
      expect(await ConditionEvaluator.evaluateOperator(1, 1, "neq", vm)).toBe(
        false,
      );
    });

    it("should evaluate gt/gte/lt/lte correctly", async () => {
      expect(await ConditionEvaluator.evaluateOperator(5, 3, "gt", vm)).toBe(
        true,
      );
      expect(await ConditionEvaluator.evaluateOperator(3, 3, "gte", vm)).toBe(
        true,
      );
      expect(await ConditionEvaluator.evaluateOperator(2, 5, "lt", vm)).toBe(
        true,
      );
      expect(await ConditionEvaluator.evaluateOperator(5, 5, "lte", vm)).toBe(
        true,
      );
    });

    it("should evaluate JS expressions on lhs", async () => {
      expect(
        await ConditionEvaluator.evaluateOperator("js:return 10", 10, "eq", vm),
      ).toBe(true);
    });

    it("should evaluate JS expressions on rhs", async () => {
      expect(
        await ConditionEvaluator.evaluateOperator(10, "js:return 10", "eq", vm),
      ).toBe(true);
    });
  });

  describe("evaluateOperatorsList()", () => {
    const vm = new JsVM({});

    it("should return true for a single true AND condition", async () => {
      const result = await ConditionEvaluator.evaluateOperatorsList(
        [{ lhs: 1, rhs: 1, operator: "eq", chain: "and" }],
        vm,
      );
      expect(result).toBe(true);
    });

    it("should return false when one AND condition is false", async () => {
      const result = await ConditionEvaluator.evaluateOperatorsList(
        [
          { lhs: 1, rhs: 1, operator: "eq", chain: "and" },
          { lhs: 1, rhs: 2, operator: "eq", chain: "and" },
        ],
        vm,
      );
      expect(result).toBe(false);
    });

    it("should return true with OR conditions meeting one group", async () => {
      const result = await ConditionEvaluator.evaluateOperatorsList(
        [
          { lhs: 1, rhs: 2, operator: "eq", chain: "or" },
          { lhs: 5, rhs: 5, operator: "eq", chain: "and" },
        ],
        vm,
      );
      expect(result).toBe(true);
    });
  });

  describe("evaluateScript()", () => {
    const vm = new JsVM({});

    it("runs a js expression inside a tagged side and keeps the tag", async () => {
      const { lhs, rhs } = await ConditionEvaluator.evaluateScript(
        { kind: "column", value: "id" },
        { kind: "literal", value: "js:return 1 + 6;" },
        vm,
      );
      expect(lhs).toEqual({ kind: "column", value: "id" });
      // without unwrapping, the literal string "js:..." reached the query and
      // Postgres rejected it against a typed id column
      expect(rhs).toEqual({ kind: "literal", value: 7 });
    });

    it("still evaluates untagged sides", async () => {
      const { lhs, rhs } = await ConditionEvaluator.evaluateScript(
        "id",
        "js:return 42;",
        vm,
      );
      expect(lhs).toBe("id");
      expect(rhs).toBe(42);
    });
  });
});
