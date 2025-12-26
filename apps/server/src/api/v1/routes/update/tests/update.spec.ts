import { describe, it, expect, vi } from "vitest";
import { db } from "../../../../../db";
import { ConflictError } from "../../../../../errors/conflictError";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../../errors/forbidError";
import { getRouteByNameOrPath, updateRoute } from "../repository";
import handleRequest from "../service";
import { HttpMethod, AuthACL } from "../../../../../db/schema";
import { publishMessage } from "../../../../../db/redis";

// Mock all imports
vi.mock("../../../../../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));
vi.mock("../../../../../db/redis", () => ({
  publishMessage: vi.fn(),
  CHAN_ON_ROUTE_CHANGE: "",
}));
vi.mock("../repository", () => ({
  getRouteByNameOrPath: vi.fn(),
  updateRoute: vi.fn(),
}));

describe("update route", () => {
  it("should return updated route if successful", async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      // mock tx object (not used in this test)
      const mockTx = {};
      return await callback(mockTx);
    });
    const mockRoute = {
      id: "123",
      name: "A",
      path: "/a",
      method: "GET" as HttpMethod,
      projectId: "proj1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (getRouteByNameOrPath as any).mockResolvedValueOnce(mockRoute);
    (updateRoute as any).mockResolvedValueOnce(mockRoute);
    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    const result = await handleRequest(
      "123",
      {
        name: "A",
        path: "/a",
        method: "GET" as HttpMethod,
        active: true,
      },
      acl
    );
    expect(result).toEqual({
      id: "123",
      name: "A",
      path: "/a",
      method: "GET" as HttpMethod,
      createdAt: mockRoute.createdAt.toISOString(),
      updatedAt: mockRoute.updatedAt.toISOString(),
    });
  });
  it("should throw NotFoundError if route not found", async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      // mock tx object (not used in this test)
      const mockTx = {};
      return await callback(mockTx);
    });

    (getRouteByNameOrPath as any).mockResolvedValueOnce(null);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(
      handleRequest(
        "123",
        {
          name: "A",
          path: "/a",
          method: "GET" as HttpMethod,
          active: true,
        },
        acl
      )
    ).rejects.toThrowError(NotFoundError);
  });
  it("should throw ConflictError if route already exists", async () => {
    const mockRoute = {
      id: "123",
      name: "A",
      path: "/a",
      method: "GET" as HttpMethod,
      projectId: "proj1",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const mockTx = {};
      return await callback(mockTx);
    });
    (getRouteByNameOrPath as any).mockResolvedValueOnce({
      ...mockRoute,
      id: "234",
    });
    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(handleRequest("123", mockRoute, acl)).rejects.toThrowError(
      ConflictError
    );
  });
  it("should throw ForbiddenError if user does not have access", async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const mockTx = {};
      return await callback(mockTx);
    });
    const mockRoute = {
      id: "123",
      name: "A",
      path: "/a",
      method: "GET" as HttpMethod,
      projectId: "proj2",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (getRouteByNameOrPath as any).mockResolvedValueOnce(mockRoute);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(
      handleRequest(
        "123",
        {
          name: "A",
          path: "/a",
          method: "GET" as HttpMethod,
          active: true,
        },
        acl
      )
    ).rejects.toThrowError(ForbiddenError);
  });
});
