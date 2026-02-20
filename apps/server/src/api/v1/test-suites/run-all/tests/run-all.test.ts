import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import { Hono } from "hono";
import testSuitesRegister from "../../register";
import * as runner from "../../runner";

const mockDb = {
  select: mock(() => mockDb),
  from: mock(() => mockDb),
  where: mock(() => mockDb),
  orderBy: mock(() => [
    { id: "1", routeId: "route-1", name: "Suite 1" },
    { id: "2", routeId: "route-1", name: "Suite 2" },
    { id: "3", routeId: "route-1", name: "Suite 3" },
  ]),
  then: mock((fn: any) => fn([{ id: "route-1", projectId: "proj-1" }])),
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

describe("Test Suites Endpoints - RUN ALL", () => {
  beforeEach(() => {
    mockDb.select.mockClear();
  });

  it("/run-all one failing suite does not prevent others", async () => {
    spyOn(runner, "runSuiteAssertions")
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockRejectedValueOnce(new Error("Network failed"))
      .mockResolvedValueOnce({ success: true, result: [] });

    const routeId = crypto.randomUUID();
    const req = new Request(
      `http://localhost/test-suites/run-all?route_id=${routeId}`,
      { method: "POST" },
    );
    const res = await app.request(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBeFalse();
    expect(data.result).toHaveLength(3);

    expect(data.result[0].success).toBeTrue();
    expect(data.result[0].name).toBe("Suite 1");
    expect(data.result[0].errors).toBeArrayOfSize(0);

    expect(data.result[1].success).toBeFalse();
    expect(data.result[1].name).toBe("Suite 2");
    expect(data.result[1].errors).toBeArrayOfSize(1);

    expect(data.result[2].success).toBeTrue();
    expect(data.result[2].name).toBe("Suite 3");
    expect(data.result[2].errors).toBeArrayOfSize(0);
  });
});
