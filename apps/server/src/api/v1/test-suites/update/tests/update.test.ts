import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import testSuitesRegister from "../../register";

const mockDb = {
  update: mock(() => mockDb),
  set: mock(() => mockDb),
  where: mock(() => mockDb),
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

describe("Test Suites Endpoints - UPDATE", () => {
  beforeEach(() => {
    mockDb.update.mockClear();
    mockDb.set.mockClear();
  });

  it("PUT: omitted fields are not overwritten in the DB record", async () => {
    const payload = { name: "Updated Name" };

    const req = new Request("http://localhost/test-suites/suite-123", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await app.request(req);
    expect(res.status).toBe(200);

    const setCalls = mockDb.set.mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    const setArg = (setCalls[0] as any)[0];
    expect(setArg).toHaveProperty("name", "Updated Name");
    expect(setArg).not.toHaveProperty("description");
  });
});
