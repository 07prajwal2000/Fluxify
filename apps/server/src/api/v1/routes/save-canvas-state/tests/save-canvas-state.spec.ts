import { describe, it, expect, vi, beforeEach } from "vitest";
import handleRequest from "../service";
import {
  deleteBlocks,
  deleteEdges,
  routeExist,
  upsertBlocks,
  insertEdges,
} from "../repository";
import { db } from "../../../../../db";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ServerError } from "../../../../../errors/serverError";
import { AuthACL } from "../../../../../db/schema";
import { publishMessage } from "../../../../../db/redis";

vi.mock("../repository");
vi.mock("../../../../../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));
vi.mock("../../../../../db/redis");

const mockRouteExist = vi.mocked(routeExist);
const mockDeleteBlocks = vi.mocked(deleteBlocks);
const mockDeleteEdges = vi.mocked(deleteEdges);
const mockUpsertBlocks = vi.mocked(upsertBlocks);
const mockInsertEdges = vi.mocked(insertEdges);
const mockPublishMessage = vi.mocked(publishMessage);

describe("save-canvas-state service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should save canvas state successfully", async () => {
    const mockTx = {};
    (db.transaction as any).mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });

    mockRouteExist.mockResolvedValue(true);
    mockUpsertBlocks.mockResolvedValue(undefined);
    mockInsertEdges.mockResolvedValue(undefined);
    mockDeleteBlocks.mockResolvedValue(undefined);
    mockDeleteEdges.mockResolvedValue(undefined);

    const data = {
      changes: {
        blocks: [
          {
            id: "block1",
            type: "entrypoint",
            data: { key: "value" },
            position: { x: 0, y: 0 },
            routeId: "route1",
          },
        ],
        edges: [
          {
            id: "edge1",
            from: "block1",
            to: "block2",
            fromHandle: "output",
            toHandle: "input",
            routeId: "route1",
          },
        ],
      },
      actionsToPerform: {
        blocks: [{ id: "oldblock", action: "delete" as const }],
        edges: [{ id: "oldedge", action: "delete" as const }],
      },
    };

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await handleRequest("route1", data, acl);

    expect(mockRouteExist).toHaveBeenCalledWith("route1", ["proj1"]);
    expect(mockUpsertBlocks).toHaveBeenCalled();
    expect(mockInsertEdges).toHaveBeenCalled();
    expect(mockDeleteBlocks).toHaveBeenCalledWith(["oldblock"], mockTx);
    expect(mockDeleteEdges).toHaveBeenCalledWith(["oldedge"], mockTx);
    expect(mockPublishMessage).toHaveBeenCalled();
  });

  it("should throw NotFoundError if route does not exist", async () => {
    mockRouteExist.mockResolvedValue(false);

    const data = {
      changes: { blocks: [], edges: [] },
      actionsToPerform: { blocks: [], edges: [] },
    };

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await expect(handleRequest("nonexistent", data, acl)).rejects.toThrow(
      NotFoundError
    );

    expect(mockUpsertBlocks).not.toHaveBeenCalled();
  });

  it("should handle only block changes", async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const mockTx = {};
      return await callback(mockTx);
    });

    mockRouteExist.mockResolvedValue(true);
    mockUpsertBlocks.mockResolvedValue(undefined);

    const data = {
      changes: {
        blocks: [
          {
            id: "block1",
            type: "response",
            data: { message: "hello" },
            position: { x: 100, y: 100 },
            routeId: "route1",
          },
        ],
        edges: [],
      },
      actionsToPerform: { blocks: [], edges: [] },
    };

    const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
    await handleRequest("route1", data, acl);

    expect(mockUpsertBlocks).toHaveBeenCalled();
    expect(mockInsertEdges).not.toHaveBeenCalled();
  });

  it("should validate auth with system admin role", async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const mockTx = {};
      return await callback(mockTx);
    });

    mockRouteExist.mockResolvedValue(true);
    mockUpsertBlocks.mockResolvedValue(undefined);

    const data = {
      changes: { blocks: [], edges: [] },
      actionsToPerform: { blocks: [], edges: [] },
    };

    const acl: AuthACL[] = [{ projectId: "*", role: "admin" }];
    await handleRequest("route1", data, acl);

    expect(mockRouteExist).toHaveBeenCalledWith("route1", ["*"]);
  });
});
