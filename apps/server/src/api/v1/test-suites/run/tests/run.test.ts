import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import { Hono } from "hono";
import testSuitesRegister from "../../register";
import * as runner from "../../runner";

const mockDb = {
  select: mock(() => mockDb),
  from: mock(() => mockDb),
  where: mock(() => mockDb),
  then: mock((fn: any) => fn([{ id: "suite-1", routeId: "route-1" }])),
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

describe("Test Suites Endpoints - RUN", () => {
  beforeEach(() => {
    mockDb.select.mockClear();
  });

  it("/run returns correctly index-mapped result[] for passing and failing assertions", async () => {
    spyOn(runner, "runSuiteAssertions").mockResolvedValue({
      success: false,
      result: [
        { success: true, message: "Passed" },
        { success: false, message: "Failed" },
      ],
    });

    const suiteId = crypto.randomUUID();
    const req = new Request(`http://localhost/test-suites/${suiteId}/run`, {
      method: "POST",
    });
    const res = await app.request(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBeFalse();
    expect(data.result).toHaveLength(2);
    expect(data.result[0].success).toBeTrue();
    expect(data.result[1].success).toBeFalse();
  });
});
