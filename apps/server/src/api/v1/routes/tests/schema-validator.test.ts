import { test, expect, describe } from "bun:test";
import { normalizeParamsSchema, validateRouteSchemas } from "../schema-validator";

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

  test("requires paramsSchema when the path declares parameters", () => {
    const result = validateRouteSchemas({ path: "/api/users/:userId" });
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("require a paramsSchema");
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

describe("normalizeParamsSchema", () => {
  const schema = {
    dataType: "object",
    properties: [{ key: "id", dataType: "str" }],
  };

  test("clears the params schema when the path has no params", () => {
    // The regression: /users/:id edited down to /users/without-params used to
    // keep the dead `id` schema, because an omitted field is skipped by the
    // update statement rather than nulled.
    const result = normalizeParamsSchema({
      path: "/users/without-params",
      paramsSchema: schema,
    });
    expect(result.paramsSchema).toBeNull();
  });

  test("nulls an omitted schema on a param-less path so the column is overwritten", () => {
    const result = normalizeParamsSchema({ path: "/users/all" });
    expect(result.paramsSchema).toBeNull();
  });

  test("leaves the schema untouched when the path still declares params", () => {
    const result = normalizeParamsSchema({ path: "/users/:id", paramsSchema: schema });
    expect(result.paramsSchema).toBe(schema);
  });
});
