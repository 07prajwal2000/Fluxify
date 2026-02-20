import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import testSuitesRegister from "../../register";

const mockDb = {
  insert: mock(() => mockDb),
  values: mock(() => mockDb),
  returning: mock(() => [{ id: "suite-1" }]),
};

mock.module("../../../../../db", () => {
  return { db: mockDb };
});

mock.module("../../middleware", () => {
  return {
    requireTestSuiteAccess: (role: string) => {
      return async (ctx: any, next: any) => {
        const routeRole = ctx.req.header("X-Test-Role") || "creator";
        if (role === "creator" && routeRole === "viewer") {
          return ctx.json({ type: "regular", message: "Forbidden" }, 403);
        }
        return next();
      };
    },
  };
});

const app = new Hono<any>();
testSuitesRegister.registerHandler(app);

describe("Test Suites Endpoints - CREATE", () => {
  beforeEach(() => {
    mockDb.insert.mockClear();
    mockDb.values.mockClear();
  });

  it("Happy path returns correct shape on CREATE", async () => {
    const payload = {
      name: "User Login Specs",
      route_id: crypto.randomUUID(),
      body: { username: "abc" },
      assertions: [{ target: "status", operator: "eq", expected_value: "200" }],
    };
    const req = new Request("http://localhost/test-suites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("suite-1");
  });

  it("Validation rejects meaningful bad input case (CREATE property_path)", async () => {
    const payload = {
      name: "Invalid Suite",
      route_id: crypto.randomUUID(),
      assertions: [
        {
          target: "status",
          operator: "eq",
          expected_value: "200",
          property_path: "invalid.path",
        },
      ],
    };
    const req = new Request("http://localhost/test-suites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.type).toBe("validation");
  });
});
