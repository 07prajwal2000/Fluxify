import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
import { generateOpenApiSpec } from "../service";
import * as repo from "../repository";
import * as redis from "../../../../../db/redis";
import { NotFoundError } from "../../../../../errors/notFoundError";
import * as instanceSettings from "../../../../../loaders/instanceSettingsLoader";
import { projectSettingsCache } from "../../../../../loaders/projectSettingsLoader";

const ORIGIN = "http://localhost:8080";

describe("OpenAPI Service Tests", () => {
  beforeEach(() => {
    spyOn(redis, "getCache").mockResolvedValue(null as any);
    spyOn(redis, "setCacheEx").mockResolvedValue(undefined);
    spyOn(instanceSettings, "configuredBaseDomain").mockReturnValue("");
    spyOn(instanceSettings, "baseDomain").mockReturnValue("localhost");
    delete projectSettingsCache.p1;
  });

  describe("servers", () => {
    const withDomain = (domain: string) => {
      spyOn(instanceSettings, "configuredBaseDomain").mockReturnValue(domain);
      spyOn(instanceSettings, "baseDomain").mockReturnValue(domain);
    };
    const withSubdomain = (subdomain: string) => {
      projectSettingsCache.p1 = { "settings.routing.subdomain": subdomain } as any;
    };
    const serverUrl = async () =>
      (await generateOpenApiSpec({ projectId: "p1" }, ORIGIN)).servers[0].url;

    beforeEach(() => {
      spyOn(redis, "getCache").mockResolvedValue(JSON.stringify({ openapi: "3.0.0", paths: {} }));
    });

    it("points at the project's subdomain", async () => {
      withDomain("example.com");
      withSubdomain("billing");
      expect(await serverUrl()).toBe("https://billing.example.com");
    });

    it("points at the base domain without a subdomain", async () => {
      withDomain("example.com");
      expect(await serverUrl()).toBe("https://example.com");
    });

    it("keeps the request's scheme and port with no base domain set", async () => {
      expect(await serverUrl()).toBe("http://localhost:8080");
      withSubdomain("billing");
      expect(await serverUrl()).toBe("http://billing.localhost:8080");
    });

    it("follows a subdomain change despite the cached spec", async () => {
      withDomain("example.com");
      withSubdomain("billing");
      expect(await serverUrl()).toBe("https://billing.example.com");
      withSubdomain("payments");
      expect(await serverUrl()).toBe("https://payments.example.com");
    });
  });

  it("returns cached spec if available", async () => {
    spyOn(redis, "getCache").mockResolvedValue(JSON.stringify({ openapi: "3.0.0", info: { title: "cached" }, paths: {} }));
    const result = await generateOpenApiSpec({ projectId: "p1" }, ORIGIN);
    expect(result.servers).toEqual([{ url: ORIGIN }]);
  });

  it("throws NotFoundError if project does not exist", async () => {
    spyOn(repo, "getProject").mockResolvedValue(null);
    expect(generateOpenApiSpec({ projectId: "p1" }, ORIGIN)).rejects.toThrow(NotFoundError);
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
            { key: "ref", dataType: "str", required: false, rules: [{ type: "format", value: "uuidv7" }] },
            { key: "site", dataType: "str", required: false, rules: [{ type: "format", value: "url" }] },
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

    const spec = await generateOpenApiSpec({ projectId: "p1" }, ORIGIN);
    
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
    expect(bodyContent.properties.ref.format).toBe("uuid");
    expect(bodyContent.properties.site.format).toBe("uri");
    expect(bodyContent.properties.age.type).toBe("integer");
    expect(bodyContent.properties.age.minimum).toBe(18);
    expect(bodyContent.properties.role.type).toBe("string");
    expect(bodyContent.properties.role.enum).toEqual(["admin", "user"]);
    expect(bodyContent.properties.tags.type).toBe("array");
    expect(bodyContent.properties.tags.items.type).toBe("string");
    expect(bodyContent.properties.tags.maxItems).toBe(10);
  });
});
