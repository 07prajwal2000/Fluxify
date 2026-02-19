import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  mock,
  type Mock,
} from "bun:test";
import handleRequest from "../service";
import {
  getIntegrationById,
  updateIntegration,
  integrationExistByName,
} from "../repository";
import { getAppConfigKeys } from "../../create/repository";
import { db } from "../../../../../db";
import { publishMessage } from "../../../../../db/redis";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ConflictError } from "../../../../../errors/conflictError";
import { ServerError } from "../../../../../errors/serverError";

// Mock dependencies
mock.module("../repository", () => ({
  getIntegrationById: mock(),
  updateIntegration: mock(),
  integrationExistByName: mock(),
}));

mock.module("../../create/repository", () => ({
  getAppConfigKeys: mock(),
}));

mock.module("../../../../../db", () => ({
  db: {
    transaction: mock(),
  },
}));

mock.module("../../../../../db/redis", () => ({
  publishMessage: mock(),
}));

mock.module("../../helpers", () => ({
  getSchema: mock(() => ({
    safeParse: mock(() => ({ success: true, data: {} })),
  })),
}));

const mockGetIntegrationById = getIntegrationById as unknown as Mock<
  typeof getIntegrationById
>;
const mockUpdateIntegration = updateIntegration as unknown as Mock<
  typeof updateIntegration
>;
const mockIntegrationExistByName = integrationExistByName as unknown as Mock<
  typeof integrationExistByName
>;
const mockGetAppConfigKeys = getAppConfigKeys as unknown as Mock<
  typeof getAppConfigKeys
>;
const mockDbTransaction = db.transaction as unknown as Mock<
  typeof db.transaction
>;
const mockPublishMessage = publishMessage as unknown as Mock<
  typeof publishMessage
>;

describe("updateIntegration service", () => {
  const mockTx = {};
  const integrationId = "test-id";
  const updateData = {
    name: "updated-integration",
    config: { url: "postgres://updated" },
  };

  beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString(
      "base64",
    );
  });

  beforeEach(() => {
    mockGetIntegrationById.mockClear();
    mockUpdateIntegration.mockClear();
    mockIntegrationExistByName.mockClear();
    mockGetAppConfigKeys.mockClear();
    mockDbTransaction.mockClear();
    mockPublishMessage.mockClear();

    mockDbTransaction.mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });
    mockGetAppConfigKeys.mockResolvedValue([] as any);
  });

  it("should successfully update an integration", async () => {
    const existingIntegration = {
      id: integrationId,
      name: "old-name",
      group: "database",
      variant: "PostgreSQL",
      config: { url: "postgres://old" },
    };

    const updatedIntegration = {
      ...existingIntegration,
      ...updateData,
    };

    mockGetIntegrationById.mockResolvedValue(existingIntegration as any);
    mockIntegrationExistByName.mockResolvedValue({ id: integrationId } as any); // Same ID, so allowed
    mockUpdateIntegration.mockResolvedValue(updatedIntegration as any);

    const result = await handleRequest(integrationId, updateData as any);

    expect(mockGetIntegrationById).toHaveBeenCalledWith(integrationId, mockTx);
    expect(mockUpdateIntegration).toHaveBeenCalledWith(
      integrationId,
      updateData,
      mockTx,
    );
    expect(mockPublishMessage).toHaveBeenCalled();
    expect(result).toEqual(updatedIntegration);
  });

  it("should throw NotFoundError when integration does not exist", async () => {
    mockGetIntegrationById.mockResolvedValue(null as any);

    await expect(
      handleRequest(integrationId, updateData as any),
    ).rejects.toThrow(NotFoundError);
    expect(mockUpdateIntegration).not.toHaveBeenCalled();
  });

  it("should throw ConflictError when new name already exists", async () => {
    const existingIntegration = {
      id: integrationId,
      name: "old-name",
      group: "database",
      variant: "PostgreSQL",
      config: {},
    };

    mockGetIntegrationById.mockResolvedValue(existingIntegration as any);
    mockIntegrationExistByName.mockResolvedValue({ id: "different-id" } as any); // Different ID

    await expect(
      handleRequest(integrationId, updateData as any),
    ).rejects.toThrow(ConflictError);
    expect(mockUpdateIntegration).not.toHaveBeenCalled();
  });

  it("should throw ServerError when update fails", async () => {
    const existingIntegration = {
      id: integrationId,
      name: "old-name",
      group: "database",
      variant: "PostgreSQL",
      config: {},
    };

    mockGetIntegrationById.mockResolvedValue(existingIntegration as any);
    mockIntegrationExistByName.mockResolvedValue(null as any); // Name not taken

    // Simulate failure: updateIntegration returns null or transaction logic fails?
    // Code says: if (!result) throw ServerError.
    // Result comes from transaction. Callback returns await updateIntegration().
    // So if updateIntegration returns null/undefined, then result is null/undefined.
    mockUpdateIntegration.mockResolvedValue(null as any);

    await expect(
      handleRequest(integrationId, updateData as any),
    ).rejects.toThrow(ServerError);
  });

  it("should allow updating with same name", async () => {
    const existingIntegration = {
      id: integrationId,
      name: "same-name",
      group: "database",
      variant: "PostgreSQL",
      config: { url: "postgres://old" },
    };

    const updateDataSameName = {
      name: "same-name",
      config: { url: "postgres://updated" },
    };

    const updatedIntegration = {
      ...existingIntegration,
      ...updateDataSameName,
    };

    mockGetIntegrationById.mockResolvedValue(existingIntegration as any);
    mockIntegrationExistByName.mockResolvedValue({ id: integrationId } as any); // Same ID (itself)
    mockUpdateIntegration.mockResolvedValue(updatedIntegration as any);

    const result = await handleRequest(
      integrationId,
      updateDataSameName as any,
    );

    expect(result).toEqual(updatedIntegration);
  });
});
