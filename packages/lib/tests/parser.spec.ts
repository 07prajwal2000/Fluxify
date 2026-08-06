import { beforeEach, it, expect, describe } from "bun:test";
import { HttpRouteParser } from "../routing/parser";

describe("Testing routing parser", () => {
  let parser = new HttpRouteParser();
  beforeEach(() => {
    parser = new HttpRouteParser();
  });

  it("should return route id when path and method match", () => {
    parser.buildRoutes([
      {
        routeId: "1",
        path: "/api/users",
        method: "GET",
        projectId: "",
        projectName: "",
		timeoutSeconds: 45,
      },
      {
        routeId: "2",
        path: "/api/posts",
        method: "GET",
        projectId: "",
        projectName: "",
      },
    ]);
    expect(parser.getRouteId("/api/users", "GET")?.id).toBe("1");
    expect(parser.getRouteId("/api/users", "GET")?.timeoutSeconds).toBe(45);
  });
  it("should return null when no matching found", () => {
    parser.buildRoutes([
      {
        routeId: "1",
        path: "/api/users",
        method: "GET",
        projectId: "",
        projectName: "",
      },
      {
        routeId: "2",
        path: "/api/posts",
        method: "GET",
        projectId: "",
        projectName: "",
      },
    ]);
    expect(parser.getRouteId("/api/users/123", "GET")).toBeNull();
    expect(parser.getRouteId("/api/users", "POST")).toBeNull();
  });
  it("should return route id with params", () => {
    parser.buildRoutes([
      {
        routeId: "1",
        path: "/api/users/:id",
        method: "GET",
        projectId: "",
        projectName: "",
      },
      {
        routeId: "333",
        path: "/api/posts/:id/comments",
        method: "GET",
        projectId: "",
        projectName: "",
      },
      {
        routeId: "2",
        path: "/api/posts",
        method: "GET",
        projectId: "",
        projectName: "",
      },
      {
        routeId: "555",
        path: "/api/:tenant/users/:id",
        method: "GET",
        projectId: "",
        projectName: "",
      },
    ]);
    const result = parser.getRouteId("/api/users/123", "GET");
    expect(result?.routeParams?.id).toBe("123");

    const result2 = parser.getRouteId("/api/posts/123/comments", "GET");
    expect(result2?.id).toBe("333");
    expect(result2?.routeParams?.id).toBe("123");

    const result3 = parser.getRouteId("/api/example_company/users/456", "GET");
    expect(result3?.id).toBe("555");
    expect(result3?.routeParams?.tenant).toBe("example_company");
    expect(result3?.routeParams?.id).toBe("456");
  });

  it("updates and removes one route without replacing unrelated routes", () => {
    parser.buildRoutes([
      {
        routeId: "users",
        path: "/api/users",
        method: "GET",
        projectId: "project",
        projectName: "Project",
      },
      {
        routeId: "posts",
        path: "/api/posts",
        method: "GET",
        projectId: "project",
        projectName: "Project",
      },
    ]);

    parser.upsertRoute({
      routeId: "users",
      path: "/api/members",
      method: "GET",
      projectId: "project",
      projectName: "Project",
    });

    expect(parser.getRouteId("/api/users", "GET")).toBeNull();
    expect(parser.getRouteId("/api/members", "GET")?.id).toBe("users");
    expect(parser.getRouteId("/api/posts", "GET")?.id).toBe("posts");

    parser.removeRoute("users");

    expect(parser.getRouteId("/api/members", "GET")).toBeNull();
    expect(parser.getRouteId("/api/posts", "GET")?.id).toBe("posts");
  });

  it("carries the whole route through a match, not a copied subset", () => {
    parser.upsertRoute({
      routeId: "traced",
      path: "/api/traced",
      method: "GET",
      projectId: "project",
      projectName: "Project",
      timeoutSeconds: 45,
      tracingEnabled: true,
      recordExecution: true,
      routeVersion: "2026-08-06T00:00:00.000Z",
    });

    const match = parser.getRouteId("/api/traced", "GET");
    expect(match?.timeoutSeconds).toBe(45);
    expect(match?.tracingEnabled).toBe(true);
    expect(match?.recordExecution).toBe(true);
    expect(match?.routeVersion).toBe("2026-08-06T00:00:00.000Z");
  });
});
