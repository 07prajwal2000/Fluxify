import { describe, it, expect, vi, beforeEach } from "vitest";
import handleRequest from "../service";
import { getRouteById } from "../repository";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../../errors/forbidError";
import { AuthACL } from "../../../../../db/schema";

// Mock the repository
vi.mock("../repository", () => ({
  getRouteById: vi.fn(),
}));

const mockGetRouteById = vi.mocked(getRouteById);

describe("handleRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return the route with createdAt converted to ISO string when route exists", async () => {
    const mockRoute: any = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Test Route",
      path: "/test",
      method: "GET",
      projectId: "proj1",
      active: true,
      createdBy: "user1",
      projectName: "Test Project",
      createdAt: new Date("2023-01-01T00:00:00Z"),
      updatedAt: new Date("2023-01-01T00:00:00Z"),
    };
    mockGetRouteById.mockResolvedValue(mockRoute);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    const result = await handleRequest(
      "123e4567-e89b-12d3-a456-426614174000",
      acl
    );

    expect(result).toEqual({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Test Route",
      path: "/test",
      method: "GET",
      projectId: "proj1",
      active: true,
      createdBy: "user1",
      projectName: "Test Project",
      createdAt: mockRoute.createdAt.toISOString(),
      updatedAt: mockRoute.updatedAt.toISOString(),
    });
    expect(mockGetRouteById).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000"
    );
  });

  it("should throw NotFoundError when route does not exist", async () => {
    mockGetRouteById.mockResolvedValue(null);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(handleRequest("non-existent-id", acl)).rejects.toThrow(
      NotFoundError
    );
    await expect(handleRequest("non-existent-id", acl)).rejects.toThrow(
      "no route found with id: non-existent-id"
    );
    expect(mockGetRouteById).toHaveBeenCalledWith("non-existent-id");
  });

  it("should throw ForbiddenError when user does not have access to the project", async () => {
    const mockRoute: any = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Test Route",
      path: "/test",
      method: "GET",
      projectId: "proj2",
      active: true,
      createdBy: "user1",
      projectName: "Test Project",
      createdAt: new Date("2023-01-01T00:00:00Z"),
      updatedAt: new Date("2023-01-01T00:00:00Z"),
    };
    mockGetRouteById.mockResolvedValue(mockRoute);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(
      handleRequest("123e4567-e89b-12d3-a456-426614174000", acl)
    ).rejects.toThrow(ForbiddenError);
  });

  it("should allow access when user has system admin role", async () => {
    const mockRoute: any = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Test Route",
      path: "/test",
      method: "GET",
      projectId: "proj2",
      active: true,
      createdBy: "user1",
      projectName: "Test Project",
      createdAt: new Date("2023-01-01T00:00:00Z"),
      updatedAt: new Date("2023-01-01T00:00:00Z"),
    };
    mockGetRouteById.mockResolvedValue(mockRoute);

    const acl: AuthACL[] = [{ projectId: "*", role: "admin" }];
    const result = await handleRequest(
      "123e4567-e89b-12d3-a456-426614174000",
      acl
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "Test Route",
      })
    );
  });
});
