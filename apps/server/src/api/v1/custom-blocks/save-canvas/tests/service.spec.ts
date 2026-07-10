import { describe, it, expect, spyOn, mock } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import * as getRepo from "../../get-canvas-items/repository";
import { NotFoundError } from "../../../../../errors/notFoundError";

mock.module("../../../../../db", () => ({
  db: {
    transaction: async (cb: any) => await cb(null),
  },
}));

mock.module("../../../../../db/redis", () => ({
  publishMessage: mock(),
  CHAN_ON_CUSTOM_BLOCK_CHANGE: "chan:on-custom-block-change",
}));

describe("Custom Blocks save-canvas service", () => {
  it("should process actions and embed edges correctly", async () => {
    spyOn(repository, "customBlockExist").mockResolvedValue(true);
    
    spyOn(getRepo, "getCustomBlockGraphs").mockResolvedValue([
      {
        id: "block1",
        type: "Trigger",
        data: {
          position: { x: 0, y: 0 },
          connections: [
            { id: "edge1", to: "block2", fromHandle: "a", toHandle: "b" }
          ],
        },
      } as any,
    ]);

    const deleteSpy = spyOn(repository, "deleteGraphs").mockResolvedValue();
    const upsertSpy = spyOn(repository, "upsertGraphs").mockResolvedValue();
    const updateTimeSpy = spyOn(repository, "setUpdatedAtTimeForCustomBlock").mockResolvedValue();

    await handleRequest(
      "cb-1",
      {
        actionsToPerform: {
          blocks: [{ id: "blockDelete", action: "delete" }],
          edges: [{ id: "edge1", action: "delete" }],
        },
        changes: {
          blocks: [
            {
              id: "block2",
              type: "Action",
              data: { label: "New Block" },
              position: { x: 100, y: 100 },
            } as any,
          ],
          edges: [
            {
              id: "edge2",
              from: "block2",
              to: "block1",
              fromHandle: "source",
              toHandle: "target",
            },
          ],
        },
      },
      [{ projectId: "proj1", role: "creator" }] as any
    );

    expect(deleteSpy).toHaveBeenCalledWith(["blockDelete"], null);
    
    // Check that edges were updated properly
    expect(upsertSpy).toHaveBeenCalled();
    const upsertedBlocks = upsertSpy.mock.calls[0][0];
    
    // Block1 should have lost edge1
    const block1 = upsertedBlocks.find((b: any) => b.id === "block1");
    expect(block1.data.connections).toEqual([]);

    // Block2 should have gained edge2
    const block2 = upsertedBlocks.find((b: any) => b.id === "block2");
    expect(block2.data.connections).toEqual([
      {
        id: "edge2",
        to: "block1",
        fromHandle: "source",
        toHandle: "target",
      },
    ]);

    expect(updateTimeSpy).toHaveBeenCalledWith("cb-1", null);
  });

  it("should throw NotFoundError if block doesn't exist", async () => {
    spyOn(repository, "customBlockExist").mockResolvedValue(false);
    
    expect(
      handleRequest("cb-1", {} as any, [])
    ).rejects.toThrow(NotFoundError);
  });
});
