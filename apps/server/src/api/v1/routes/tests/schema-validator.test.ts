import { test, expect, describe } from "bun:test";
import { validateRouteSchemas } from "../schema-validator";

describe("validateRouteSchemas", () => {
  test("returns success for valid schemas without params", () => {
    const result = validateRouteSchemas({
      path: "/api/users",
      bodySchema: {
        dataType: "object",
        properties: [{ key: "name", dataType: "str" }]
      }
    });
    expect(result.success).toBe(true);
  });

  test("validates that all path params exist in paramsSchema", () => {
    const result = validateRouteSchemas({
      path: "/api/users/:userId/posts/:postId",
      paramsSchema: {
        dataType: "object",
        properties: [
          { key: "userId", dataType: "str" },
          { key: "postId", dataType: "str" }
        ]
      }
    });
    expect(result.success).toBe(true);
  });

  test("fails if path param is missing in paramsSchema", () => {
    const result = validateRouteSchemas({
      path: "/api/users/:userId/posts/:postId",
      paramsSchema: {
        dataType: "object",
        properties: [
          { key: "userId", dataType: "str" }
        ]
      }
    });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain("missing from paramsSchema");
  });

  test("fails if paramsSchema has extra params not in path", () => {
    const result = validateRouteSchemas({
      path: "/api/users/:userId",
      paramsSchema: {
        dataType: "object",
        properties: [
          { key: "userId", dataType: "str" },
          { key: "extraParam", dataType: "str" }
        ]
      }
    });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain("not in the route path");
  });
});
