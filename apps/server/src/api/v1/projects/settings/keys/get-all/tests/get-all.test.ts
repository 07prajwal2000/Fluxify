import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import * as redis from "../../../../../../../db/redis";

import { NotFoundError } from "../../../../../../../errors/notFoundError";

mock.module("../repository", () => ({
  getProjectSettingsKeys: mock(),
  checkProjectExists: mock(),
}));

mock.module("../../../../../../../db/redis", () => ({
  getCache: mock(),
  setCache: mock(),
}));

describe("get-all project settings service", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("should return cached settings if available", async () => {
    const projectId = "proj-1";
    const cachedData = JSON.stringify({
      "settings.ai.agentConnectionId": "cache-value",
    });

    (repository.checkProjectExists as any).mockResolvedValue(true);
    (redis.getCache as any).mockResolvedValue(cachedData);

    const result = await handleRequest(projectId);

    expect(redis.getCache).toHaveBeenCalledWith(
      `PROJECT-SETTINGS-${projectId}`,
    );
    expect(repository.getProjectSettingsKeys).not.toHaveBeenCalled();
    expect(result).toEqual({ "settings.ai.agentConnectionId": "cache-value" });
  });

  it("should fetch from repository and set cache if not cached", async () => {
    const projectId = "proj-1";

    (repository.checkProjectExists as any).mockResolvedValue(true);
    (redis.getCache as any).mockResolvedValue(null);
    (repository.getProjectSettingsKeys as any).mockResolvedValue([
      { key: "settings.ai.agentConnectionId", value: "repo-value" },
    ]);

    const result = await handleRequest(projectId);

    expect(redis.getCache).toHaveBeenCalledWith(
      `PROJECT-SETTINGS-${projectId}`,
    );
    expect(repository.getProjectSettingsKeys).toHaveBeenCalledWith(projectId);

    const expectedResult = { "settings.ai.agentConnectionId": "repo-value" };
    expect(result).toEqual(expectedResult);
    expect(redis.setCache).toHaveBeenCalledWith(
      `PROJECT-SETTINGS-${projectId}`,
      JSON.stringify(expectedResult),
    );
  });

  it("should throw NotFoundError if project does not exist", async () => {
    const projectId = "proj-1";
    (repository.checkProjectExists as any).mockResolvedValue(false);

    expect(handleRequest(projectId)).rejects.toThrow(NotFoundError);
  });
});
