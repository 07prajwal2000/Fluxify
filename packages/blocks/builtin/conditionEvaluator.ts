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
  public static evaluateOperatorsList(
    conditions: z.infer<typeof conditionSchema>[],
    vm: JsVM,
    params?: any,
  ): boolean {
    const operatorResults: OperatorResult[] = [];
    for (const condition of conditions) {
      const { lhs, rhs, operator, js, chain } = condition;
      const operatorResult = ConditionEvaluator.evaluateOperator(
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
  public static evaluateOperator(
    lhs: any,
    rhs: any,
    operator: z.infer<typeof operatorSchema>,
    vm: JsVM,
    js?: string,
    extras?: any,
  ): boolean {
    return evaluateOperator(vm, lhs, rhs, operator, js, extras);
  }
}
