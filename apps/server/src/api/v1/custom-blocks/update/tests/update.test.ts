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

import handleRequest from "../service";
import * as repo from "../repository";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../../errors/forbidError";
import { ConflictError } from "../../../../../errors/conflictError";
import * as authCommon from "../../../../auth/common";

describe("Update Custom Block Service", () => {
  const mockUser = { id: "user1", isSystemAdmin: false } as any;
  const mockAcl = [{ projectId: "proj_123", role: "creator" as any }];

  beforeEach(() => {
    mock.restore();
  });

  it("should update successfully", async () => {
    spyOn(repo, "getCustomBlockById").mockResolvedValue({ id: "block_123", projectId: "proj_123" } as any);
    spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);
    spyOn(repo, "checkCustomBlockNameExist").mockResolvedValue(false);
    spyOn(repo, "updateCustomBlock").mockResolvedValue({ id: "block_123" } as any);

    const res = await handleRequest("block_123", { name: "new_name" }, mockUser, mockAcl);
    expect(res.id).toBe("block_123");
  });

  it("should throw Forbidden if user lacks access", async () => {
    spyOn(repo, "getCustomBlockById").mockResolvedValue({ id: "block_123", projectId: "proj_123" } as any);
    spyOn(authCommon, "hasProjectAccess").mockReturnValue(false);

    expect(handleRequest("block_123", { name: "new_name" }, mockUser, mockAcl)).rejects.toThrow(ForbiddenError);
  });
  

});
