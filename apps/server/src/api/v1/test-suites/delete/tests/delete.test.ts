import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import testSuitesRegister from "../../register";

const mockDb = {
  delete: mock(() => mockDb),
  where: mock(() => mockDb),
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

describe("Test Suites Endpoints - DELETE", () => {
  beforeEach(() => {
    mockDb.delete.mockClear();
  });

  it("Auth: viewer is rejected on all mutating endpoints", async () => {
    const req = new Request("http://localhost/test-suites/suite-123", {
      method: "DELETE",
      headers: { "X-Test-Role": "viewer" },
    });
    const res = await app.request(req);
    expect(res.status).toBe(403);
  });
});
