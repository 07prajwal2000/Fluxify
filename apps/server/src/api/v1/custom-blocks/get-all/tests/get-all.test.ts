import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
import handleRequest from "../service";
import * as repo from "../repository";

describe("Get-All Custom Blocks Service", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("should return formatted blocks", async () => {
    spyOn(repo, "getCustomBlocks").mockResolvedValue([
      { id: "1", label: "A", name: "a", icon: null, iconUrl: null, inputParams: [] } as any
    ]);

    const res = await handleRequest({ projectId: "proj_123" });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("1");
    expect(res[0].label).toBe("A");
    expect(res[0].name).toBe("a");
  });
});
