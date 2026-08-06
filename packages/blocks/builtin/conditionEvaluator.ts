import {
  conditionSchema,
  evaluateOperator,
  JsVM,
  operatorSchema,
} from "@fluxify/lib";
import z from "zod";

export enum OperatorResult {
  TRUE = 1,
  FALSE = 2,
  OR = 3,
}

export class ConditionEvaluator {
  public static async evaluateOperatorsList(
    conditions: z.infer<typeof conditionSchema>[],
    vm: JsVM,
    params?: any,
  ): Promise<boolean> {
    const operatorResults: OperatorResult[] = [];
    for (const condition of conditions) {
      const { lhs, rhs, operator, js, chain } = condition;
      const operatorResult = await ConditionEvaluator.evaluateOperator(
        lhs,
        rhs,
        operator,
        vm,
        js,
        params,
      );
      operatorResults.push(
        operatorResult ? OperatorResult.TRUE : OperatorResult.FALSE,
      );
      if (chain == "and") continue;
      operatorResults.push(OperatorResult.OR);
    }
    return ConditionEvaluator.evaluateResult(operatorResults);
  }
  public static evaluateResult(results: OperatorResult[]) {
    let n = results.length;
    let totalTrues = 0;
    let checkpoint = 0;
    let totalOperators = 0;
    if (results[n - 1] == OperatorResult.OR) n--;
    for (let i = 0; i < n; i++) {
      const result = results[i];
      if (result != OperatorResult.OR) totalOperators++;
      if (result == OperatorResult.TRUE) {
        totalTrues++;
      } else if (result == OperatorResult.OR) {
        if (totalTrues == i - checkpoint) {
          return true;
        }
        checkpoint = i;
        totalTrues = 0;
      }
    }
    return totalTrues == totalOperators - checkpoint;
  }
  public static async evaluateScript(lhs: any, rhs: any, vm: JsVM) {
    return {
      lhs: await ConditionEvaluator.evaluateSide(lhs, vm),
      rhs: await ConditionEvaluator.evaluateSide(rhs, vm),
    };
  }

  /**
   * A db condition side is either a bare value or a `{ kind, value }` tag. The
   * js: prefix lives on the payload either way, so unwrap the tag, run the
   * expression, and put the result back under the same kind — dropping the tag
   * here would turn a literal into a column reference.
   */
  private static async evaluateSide(side: any, vm: JsVM): Promise<any> {
    if (side && typeof side === "object" && "kind" in side) {
      return { ...side, value: await ConditionEvaluator.evaluateSide(side.value, vm) };
    }
    return typeof side === "string" && side.startsWith("js:")
      ? await vm.run(side.slice(3))
      : side;
  }
  public static async evaluateOperator(
    lhs: any,
    rhs: any,
    operator: z.infer<typeof operatorSchema>,
    vm: JsVM,
    js?: string,
    extras?: any,
  ): Promise<boolean> {
    return await evaluateOperator(vm, lhs, rhs, operator, js, extras);
  }
}
