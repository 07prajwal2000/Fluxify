import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
import { generateOpenApiSpec } from "../service";
import * as repo from "../repository";
import * as redis from "../../../../../db/redis";
import { NotFoundError } from "../../../../../errors/notFoundError";

describe("OpenAPI Service Tests", () => {
  beforeEach(() => {
    spyOn(redis, "getCache").mockResolvedValue(null as any);
    spyOn(redis, "setCacheEx").mockResolvedValue(undefined);
  });

  it("returns cached spec if available", async () => {
    spyOn(redis, "getCache").mockResolvedValue(JSON.stringify({ cached: true }));
    const result = await generateOpenApiSpec({ projectId: "p1" });
    expect(result).toEqual({ cached: true });
  });

  it("throws NotFoundError if project does not exist", async () => {
    spyOn(repo, "getProject").mockResolvedValue(null);
    expect(generateOpenApiSpec({ projectId: "p1" })).rejects.toThrow(NotFoundError);
  });

  it("generates correct OpenAPI schema from DB custom schemas", async () => {
    spyOn(repo, "getProject").mockResolvedValue({ id: "p1", name: "My API" } as any);
    spyOn(repo, "getActiveRoutes").mockResolvedValue([
      {
        id: "r1",
        method: "post",
        name: "Create User",
        path: "/users/:id",
        paramsSchema: {
          dataType: "object",
          properties: [
            { key: "id", dataType: "str", rules: [{ type: "minLength", value: 5 }] },
          ],
        },
        querySchema: {
          dataType: "object",
          properties: [
            { key: "include", dataType: "bool", required: false },
          ],
        },
        bodySchema: JSON.stringify({
          dataType: "object",
          properties: [
            { key: "name", dataType: "str", rules: [{ type: "maxLength", value: 50 }] },
            { key: "age", dataType: "int", rules: [{ type: "min", value: 18 }] },
            { key: "role", dataType: "enum", rules: [{ type: "values", value: ["admin", "user"] }] },
            { 
              key: "tags", 
              dataType: "arr", 
              items: { dataType: "str" },
              rules: [{ type: "maxItems", value: 10 }]
            }
          ]
        })
      }
    ] as any);

    const spec = await generateOpenApiSpec({ projectId: "p1" });
    
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.info.title).toBe("My API");
    expect(spec.paths["/users/{id}"]).toBeDefined();
    
    const op = spec.paths["/users/{id}"]["post"];
    expect(op.summary).toBe("Create User");
    
    // Validate path param
    const idParam = op.parameters.find((p: any) => p.name === "id");
    expect(idParam.in).toBe("path");
    expect(idParam.required).toBe(true);
    expect(idParam.schema.type).toBe("string");
    expect(idParam.schema.minLength).toBe(5);

    // Validate query param
    const incParam = op.parameters.find((p: any) => p.name === "include");
    expect(incParam.in).toBe("query");
    expect(incParam.required).toBe(false);
    expect(incParam.schema.type).toBe("boolean");

    // Validate request body
    const bodyContent = op.requestBody.content["application/json"].schema;
    expect(bodyContent.type).toBe("object");
    expect(bodyContent.required).toEqual(["name", "age", "role", "tags"]);
    expect(bodyContent.properties.name.type).toBe("string");
    expect(bodyContent.properties.name.maxLength).toBe(50);
    expect(bodyContent.properties.age.type).toBe("integer");
    expect(bodyContent.properties.age.minimum).toBe(18);
    expect(bodyContent.properties.role.type).toBe("string");
    expect(bodyContent.properties.role.enum).toEqual(["admin", "user"]);
    expect(bodyContent.properties.tags.type).toBe("array");
    expect(bodyContent.properties.tags.items.type).toBe("string");
    expect(bodyContent.properties.tags.maxItems).toBe(10);
  });
});
