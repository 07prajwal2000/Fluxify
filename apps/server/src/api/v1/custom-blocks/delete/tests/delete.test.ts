import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
mock.module("../../../../../db", () => ({
  db: {
    transaction: async (cb: any) => await cb({}),
  },
}));

mock.module("../../../../../db/redis", () => ({
  publishMessage: mock(),
  CHAN_ON_CUSTOM_BLOCK_CHANGE: "chan:on-custom-block-change",
}));

mock.module("../../../../../modules/compiler/service", () => ({
  dropCustomBlock: mock(),
}));

// the finder is tested against a real database (modules/references/tests)
const assertNotInUse = mock(async (..._args: unknown[]) => {});
mock.module("../../../../../modules/references/service", () => ({ assertNotInUse }));

import handleRequest from "../service";
import * as repo from "../repository";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../../errors/forbidError";
import * as authCommon from "../../../../auth/common";

describe("Delete Custom Block Service", () => {
  const mockUser = { id: "user1", isSystemAdmin: false } as any;
  const mockAcl = [{ projectId: "proj_123", role: "creator" as any }];

  beforeEach(() => {
    mock.restore();
    assertNotInUse.mockReset();
    assertNotInUse.mockResolvedValue(undefined);
  });

  it("should delete successfully", async () => {
    spyOn(repo, "getCustomBlockById").mockResolvedValue({ id: "block_1", projectId: "proj_123", sourceType: "inhouse" } as any);
    spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);
    spyOn(repo, "deleteCustomBlock").mockResolvedValue(undefined);

    const res = await handleRequest("block_1", mockUser, mockAcl);
    expect(res.id).toBe("block_1");
    expect(assertNotInUse).toHaveBeenCalledTimes(1);
  });

  it("refuses while the finder says something uses the block (#740)", async () => {
    spyOn(repo, "getCustomBlockById").mockResolvedValue({ id: "block_1", name: "Auth", projectId: "proj_123", sourceType: "inhouse" } as any);
    spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);
    assertNotInUse.mockRejectedValue(new Error('This custom block is still used by middleware "Auth"'));
    const del = spyOn(repo, "deleteCustomBlock").mockResolvedValue(undefined);

    await expect(handleRequest("block_1", mockUser, mockAcl)).rejects.toThrow("still used by");
    expect(assertNotInUse).toHaveBeenCalledWith(
      "custom_block",
      { id: "block_1", name: "Auth", projectId: "proj_123" },
      expect.anything(),
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("should throw Forbidden if block is from plugin", async () => {
    spyOn(repo, "getCustomBlockById").mockResolvedValue({ id: "block_1", projectId: "proj_123", sourceType: "plugin" } as any);
    spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);

    expect(handleRequest("block_1", mockUser, mockAcl)).rejects.toThrow(ForbiddenError);
  });
});
