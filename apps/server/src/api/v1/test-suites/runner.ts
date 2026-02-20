import { app } from "../../../server";
import { testSuitesEntity, routesEntity } from "../../../db/schema";
import { InferSelectModel } from "drizzle-orm";
import { JsVM } from "@fluxify/lib";
import { z } from "zod";
import { assertionSchema } from "./schema";

export type AssertionType = z.infer<typeof assertionSchema>;

export async function runSuiteAssertions(
  suite: InferSelectModel<typeof testSuitesEntity>,
  route: InferSelectModel<typeof routesEntity>,
) {
  let finalPath = route.path || "";
  const pathParams = (suite.routeParams as Record<string, string>) || {};

  Object.entries(pathParams).forEach(([key, value]) => {
    finalPath = finalPath.replace(
      `:${key}`,
      encodeURIComponent(value || `:${key}`),
    );
  });

  const queryParams = (suite.queryParams as Record<string, string>) || {};
  const searchParams = new URLSearchParams();
  Object.entries(queryParams).forEach(([key, value]) => {
    if (key) searchParams.append(key, value);
  });
  const qs = searchParams.toString();
  const urlPath = `${finalPath}${qs ? `?${qs}` : ""}`;

  const headers = new Headers();
  Object.entries((suite.headers as Record<string, string>) || {}).forEach(
    ([k, v]) => headers.set(k, v),
  );
  const method = route.method || "GET";

  // default json
  if (
    !headers.has("Content-Type") &&
    ["POST", "PUT"].includes(method.toUpperCase())
  ) {
    headers.set("Content-Type", "application/json");
  }

  const reqInit: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  if (!["GET", "DELETE"].includes(method.toUpperCase()) && suite.body) {
    reqInit.body =
      typeof suite.body === "string" ? suite.body : JSON.stringify(suite.body);
  }

  // Use app.request to bypass network
  const startTime = Date.now();
  let res: Response;
  try {
    res = await app.request("http://localhost" + urlPath, reqInit);
  } catch (e: any) {
    // Mock a 500 response
    res = new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  const time = Date.now() - startTime;

  const resStatus = res.status;
  const resHeaders = Object.fromEntries(res.headers.entries());
  let resBody: unknown = null;
  const text = await res.text();
  try {
    resBody = JSON.parse(text);
  } catch (_e) {
    resBody = text;
  }

  const assertions = (suite.assertions as AssertionType[]) || [];
  const result = assertions.map((a: AssertionType) => {
    let actualValue: unknown;
    let targetDesc = "";

    try {
      if (a.target === "status") {
        actualValue = resStatus;
        targetDesc = "Status";
      } else if (a.target === "time") {
        actualValue = time;
        targetDesc = "Time";
      } else if (a.target === "header") {
        actualValue = resHeaders[(a.property_path || "").toLowerCase()];
        targetDesc = `Header(${a.property_path})`;
      } else if (a.target === "body") {
        // Evaluate dot-notation path
        if (a.property_path) {
          const parts = a.property_path
            .replace(/\[(\d+)\]/g, ".$1")
            .split(".")
            .filter(Boolean);
          let curr: any = resBody;
          for (const p of parts) {
            if (curr === undefined || curr === null) break;
            curr = curr[p];
          }
          actualValue = curr;
        } else {
          actualValue = resBody;
        }
        targetDesc = `Body(${a.property_path || ""})`;
      } else if (a.target === "custom_js") {
        console.log(resBody, resHeaders, resStatus);

        const vm = new JsVM({
          body: resBody,
          headers: resHeaders,
          status: resStatus,
        });
        actualValue = vm.run(a.custom_js || "return true;");
        targetDesc = "Custom JS";
      }

      let passed = false;
      if (a.target === "custom_js") {
        passed = new JsVM({
          body: resBody,
          headers: resHeaders,
          status: resStatus,
        }).truthy(actualValue);
      }

      const expected = a.expected_value == null ? "" : String(a.expected_value);
      const actualStr = actualValue == null ? "" : String(actualValue);

      if (a.target !== "custom_js") {
        switch (a.operator) {
          case "eq":
            passed = actualStr === expected || String(actualValue) === expected;
            if (a.target === "status" || a.target === "time") {
              passed = Number(actualValue) === Number(expected);
            }
            break;
          case "neq":
            passed = actualStr !== expected;
            if (a.target === "status" || a.target === "time") {
              passed = Number(actualValue) !== Number(expected);
            }
            break;
          case "lt":
            passed = Number(actualValue) < Number(expected);
            break;
          case "gt":
            passed = Number(actualValue) > Number(expected);
            break;
          case "contains":
            passed =
              typeof actualValue === "string"
                ? actualValue.includes(expected)
                : JSON.stringify(actualValue).includes(expected);
            break;
          case "true":
            passed = actualValue === true || actualStr === "true";
            break;
          case "false":
            passed = actualValue === false || actualStr === "false";
            break;
          case "exists":
            passed = actualValue !== undefined && actualValue !== null;
            break;
          case "not_exists":
            passed = actualValue === undefined || actualValue === null;
            break;
          default:
            passed = false;
        }
      }

      const opStr = a.operator ? a.operator.replace("_", " ") : "";
      return {
        success: passed,
        message: passed
          ? `${targetDesc} ${a.target !== "custom_js" ? opStr + " " + (a.expected_value || "") : ""} ✓`
          : a.target === "custom_js"
            ? `Custom JS evaluated to falsy (${actualStr})`
            : `Expected ${targetDesc} to ${opStr} ${a.expected_value || ""}, got: ${actualStr}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: `Evaluation error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  const allPassed = result.length === 0 || result.every((r) => r.success);

  return {
    success: allPassed,
    result,
  };
}
