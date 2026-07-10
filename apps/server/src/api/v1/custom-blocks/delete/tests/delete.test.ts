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
import * as authCommon from "../../../../auth/common";

describe("Delete Custom Block Service", () => {
  const mockUser = { id: "user1", isSystemAdmin: false } as any;
  const mockAcl = [{ projectId: "proj_123", role: "creator" as any }];

  beforeEach(() => {
    mock.restore();
  });

  it("should delete successfully", async () => {
    spyOn(repo, "getCustomBlockById").mockResolvedValue({ id: "block_1", projectId: "proj_123", sourceType: "inhouse" } as any);
    spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);
    spyOn(repo, "deleteCustomBlock").mockResolvedValue(undefined);

    const res = await handleRequest("block_1", mockUser, mockAcl);
    expect(res.id).toBe("block_1");
  });

  it("should throw Forbidden if block is from plugin", async () => {
    spyOn(repo, "getCustomBlockById").mockResolvedValue({ id: "block_1", projectId: "proj_123", sourceType: "plugin" } as any);
    spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);

    expect(handleRequest("block_1", mockUser, mockAcl)).rejects.toThrow(ForbiddenError);
  });
});
