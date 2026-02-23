import { describe, expect, it, mock, beforeEach } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import * as redis from "../../../../../../../db/redis";
import * as connection from "../connection";
import { BadRequestError } from "../../../../../../../errors/badRequestError";
import { NotFoundError } from "../../../../../../../errors/notFoundError";

mock.module("../repository", () => ({
  upsertProjectSettingKey: mock(),
  checkProjectExists: mock(),
}));

mock.module("../../../../../../../db/redis", () => ({
  deleteCacheKey: mock(),
}));

mock.module("../connection", () => ({
  testConnectionFn: mock(),
}));

describe("upsert project settings service", () => {
  beforeEach(() => {
    mock.restore();
    (repository.upsertProjectSettingKey as any).mockClear();
    (repository.checkProjectExists as any).mockClear();
    (redis.deleteCacheKey as any).mockClear();
    (connection.testConnectionFn as any).mockClear();
  });

  it("should throw BadRequestError for an invalid key", async () => {
    const projectId = "proj-1";
    (repository.checkProjectExists as any).mockResolvedValue(true);

    expect(
      handleRequest(projectId, { key: "invalid.key", value: "val" }),
    ).rejects.toThrow(BadRequestError);
  });

  it("should throw BadRequestError if schema validation fails", async () => {
    const projectId = "proj-1";
    (repository.checkProjectExists as any).mockResolvedValue(true);

    expect(
      handleRequest(projectId, {
        key: "settings.ai.agentConnectionId",
        value: "invalid-uuid",
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it("should throw BadRequestError if connection test fails", async () => {
    const projectId = "proj-1";
    const validUuid = "018e6586-7a4c-7833-9111-536c4b2b71fc";
    (repository.checkProjectExists as any).mockResolvedValue(true);

    (connection.testConnectionFn as any).mockResolvedValue({
      success: false,
      message: "Connection failed mock",
    });

    expect(
      handleRequest(projectId, {
        key: "settings.ai.agentConnectionId",
        value: validUuid,
      }),
    ).rejects.toThrow(new BadRequestError("Connection failed mock"));
  });

  it("should upsert valid key-value, invalidate cache, and return success", async () => {
    const projectId = "proj-1";
    const validUuid = "018e6586-7a4c-7833-9111-536c4b2b71fc";
    (repository.checkProjectExists as any).mockResolvedValue(true);

    (connection.testConnectionFn as any).mockResolvedValue({
      success: true,
      message: "ok",
    });
    (repository.upsertProjectSettingKey as any).mockResolvedValue({});

    const result = await handleRequest(projectId, {
      key: "settings.ai.agentConnectionId",
      value: validUuid,
    });

    expect(connection.testConnectionFn).toHaveBeenCalledWith(
      "settings.ai.agentConnectionId",
      validUuid,
    );
    expect(repository.upsertProjectSettingKey).toHaveBeenCalledWith(
      projectId,
      "settings.ai.agentConnectionId",
      validUuid,
    );
    expect(redis.deleteCacheKey).toHaveBeenCalledWith(
      `PROJECT-SETTINGS-${projectId}`,
    );
    expect(result).toEqual({ message: "Setting saved successfully" });
  });

  it("should use default value if missing", async () => {
    const projectId = "proj-1";
    (repository.checkProjectExists as any).mockResolvedValue(true);

    (connection.testConnectionFn as any).mockResolvedValue({
      success: true,
      message: "ok",
    });
    (repository.upsertProjectSettingKey as any).mockResolvedValue({});

    const result = await handleRequest(projectId, {
      key: "settings.ai.agentConnectionId",
    });

    expect(connection.testConnectionFn).not.toHaveBeenCalled();
    expect(repository.upsertProjectSettingKey).toHaveBeenCalledWith(
      projectId,
      "settings.ai.agentConnectionId",
      "",
    );
    expect(result).toEqual({ message: "Setting saved successfully" });
  });

  it("should throw NotFoundError if project does not exist", async () => {
    const projectId = "proj-1";
    (repository.checkProjectExists as any).mockResolvedValue(false);

    expect(
      handleRequest(projectId, {
        key: "settings.ai.agentConnectionId",
        value: "validUuid",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
