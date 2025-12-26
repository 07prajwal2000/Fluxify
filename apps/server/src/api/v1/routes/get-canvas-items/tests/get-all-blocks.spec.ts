import { describe, it, expect, vi, beforeEach } from "vitest";
import handleRequest from "../service";
import { getBlocks, getEdges, routeExist } from "../repository";
import { db } from "../../../../../db";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ServerError } from "../../../../../errors/serverError";
import { AuthACL } from "../../../../../db/schema";

// Mock the db
vi.mock("../../../../../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

// Mock the repository
vi.mock("../repository", () => ({
  getBlocks: vi.fn(),
  getEdges: vi.fn(),
  routeExist: vi.fn(),
}));

const mockDbTransaction = vi.mocked(db.transaction);
const mockGetBlocks = vi.mocked(getBlocks);
const mockGetEdges = vi.mocked(getEdges);
const mockRouteExist = vi.mocked(routeExist);

describe("handleRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return blocks and edges when route exists", async () => {
    const mockTx = {};
    mockDbTransaction.mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });

    mockRouteExist.mockResolvedValue(true);
    mockGetBlocks.mockResolvedValue([
      {
        id: "block1",
        type: "entrypoint",
        data: { key: "value" },
        position: { x: 100, y: 200 },
      },
      {
        id: "block2",
        type: "response",
        data: { message: "hello" },
        position: { x: 300, y: 400 },
      },
    ]);
    mockGetEdges.mockResolvedValue([
      {
        id: "edge1",
        from: "block1",
        to: "block2",
        fromHandle: "output",
        toHandle: "input",
      },
    ]);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    const result = await handleRequest("route123", acl);

    expect(result).toEqual({
      blocks: [
        {
          id: "block1",
          type: "entrypoint",
          data: { key: "value" },
          position: { x: 100, y: 200 },
        },
        {
          id: "block2",
          type: "response",
          data: { message: "hello" },
          position: { x: 300, y: 400 },
        },
      ],
      edges: [
        {
          id: "edge1",
          from: "block1",
          to: "block2",
          fromHandle: "output",
          toHandle: "input",
        },
      ],
    });

    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(mockRouteExist).toHaveBeenCalledWith(
      "route123",
      ["proj1"],
      mockTx as any
    );
    expect(mockGetBlocks).toHaveBeenCalledWith("route123", mockTx as any);
    expect(mockGetEdges).toHaveBeenCalledWith("route123", mockTx as any);
  });

  it("should throw NotFoundError when route does not exist", async () => {
    const mockTx = {};
    mockDbTransaction.mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });

    mockRouteExist.mockResolvedValue(false);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(handleRequest("nonexistent", acl)).rejects.toThrow(
      NotFoundError
    );
    await expect(handleRequest("nonexistent", acl)).rejects.toThrow(
      "Route not found"
    );

    expect(mockRouteExist).toHaveBeenCalledWith(
      "nonexistent",
      ["proj1"],
      mockTx as any
    );
    expect(mockGetBlocks).not.toHaveBeenCalled();
    expect(mockGetEdges).not.toHaveBeenCalled();
  });

  it("should throw ServerError when transaction returns no result", async () => {
    mockDbTransaction.mockResolvedValue(undefined);

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(handleRequest("route123", acl)).rejects.toThrow(ServerError);
    await expect(handleRequest("route123", acl)).rejects.toThrow(
      "Something went wrong"
    );

    expect(mockRouteExist).not.toHaveBeenCalled();
    expect(mockGetBlocks).not.toHaveBeenCalled();
    expect(mockGetEdges).not.toHaveBeenCalled();
  });

  it("should validate auth and allow access with system admin role", async () => {
    const mockTx = {};
    mockDbTransaction.mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });

    mockRouteExist.mockResolvedValue(true);
    mockGetBlocks.mockResolvedValue([]);
    mockGetEdges.mockResolvedValue([]);

    const acl: AuthACL[] = [{ projectId: "*", role: "admin" }];
    const result = await handleRequest("route123", acl);

    expect(result).toEqual({
      blocks: [],
      edges: [],
    });
    expect(mockRouteExist).toHaveBeenCalledWith(
      "route123",
      ["*"],
      mockTx as any
    );
  });
});
