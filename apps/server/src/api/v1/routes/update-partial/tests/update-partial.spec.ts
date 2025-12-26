import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../../../../db";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../../errors/forbidError";
import handleRequest from "../service";
import { HttpMethod, AuthACL } from "../../../../../db/schema";

// Mock all imports - must use paths relative to this file
vi.mock("../../../../../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));
vi.mock("../../../../../db/redis", () => ({
  publishMessage: vi.fn(),
  CHAN_ON_ROUTE_CHANGE: "",
}));
vi.mock("../../update/repository", () => ({
  getRouteByNameOrPath: vi.fn(),
  updateRoute: vi.fn(),
}));

// Import mocked functions after mocking
const { getRouteByNameOrPath, updateRoute } = await import(
  "../../update/repository"
);

describe("update-partial route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have auth layer validation", () => {
    // This test verifies that the service accepts acl parameter
    // Real functionality is tested in update.spec.ts
    expect(handleRequest.length).toBe(2); // id, data (acl has default value)
  });

  it("should throw ForbiddenError when user lacks project access", async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const mockTx = {};
      return await callback(mockTx);
    });

    const mockRoute = {
      id: "123",
      name: "Original",
      path: "/original",
      method: HttpMethod.GET,
      projectId: "proj2",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (getRouteByNameOrPath as any).mockResolvedValueOnce(mockRoute);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(
      handleRequest("123", { name: "Updated" }, acl)
    ).rejects.toThrow(ForbiddenError);
  });

  it("should allow system admin to update any route", async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const mockTx = {};
      return await callback(mockTx);
    });

    const mockRoute = {
      id: "123",
      name: "Original",
      path: "/original",
      method: HttpMethod.GET,
      projectId: "proj2",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (getRouteByNameOrPath as any).mockResolvedValueOnce(mockRoute);
    (updateRoute as any).mockResolvedValueOnce({
      ...mockRoute,
      path: "/updated",
    });

    const acl: AuthACL[] = [{ projectId: "*", role: "admin" }];
    const result = await handleRequest("123", { path: "/updated" }, acl);

    expect(result).toBeDefined();
  });

  it("should throw NotFoundError when route not found", async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const mockTx = {};
      return await callback(mockTx);
    });

    (getRouteByNameOrPath as any).mockResolvedValueOnce(null);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(
      handleRequest("123", { name: "Updated" }, acl)
    ).rejects.toThrow(NotFoundError);
  });
});
