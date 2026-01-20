import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockInstance,
} from "vitest";
import { getAppConfigById } from "../repository";
import { responseSchema } from "../dto";
import handleRequest from "../service";
import { BadRequestError } from "../../../../../errors/badRequestError";
import { NotFoundError } from "../../../../../errors/notFoundError";

// Mock the repository and encryption service
vi.mock("../repository");

describe("getAppConfigById service", () => {
  let mockConfig = {
    id: 1,
    keyName: "test.key.1",
    description: "Test config",
    value: "test-value-1234",
    isEncrypted: false,
    encodingType: "plaintext",
    createdAt: new Date("2023-01-01T00:00:00.000Z"),
    updatedAt: new Date("2023-01-01T00:00:00.000Z"),
  };

  let getAppConfigByIdMock: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    getAppConfigByIdMock = vi.mocked(getAppConfigById);
  });

  it("should return app config with correct structure when found", async () => {
    // Mock the repository response
    getAppConfigByIdMock.mockResolvedValueOnce({
      ...mockConfig,
      isEncrypted: false,
      dataType: "string",
    });

    const result = await handleRequest(1);

    // Verify the response matches the schema
    expect(() => responseSchema.parse(result)).not.toThrow();
  });

  it("should mask encrypted values in the response", async () => {
    // Mock the repository response with an encrypted config
    getAppConfigByIdMock.mockResolvedValueOnce({
      ...mockConfig,
      isEncrypted: true,
      value: "sensitive-data-1234",
    });

    const result = await handleRequest(1);
    // The encrypted value should be masked
    expect(result.value.split("").every((x) => x === "*")).toBe(true);
    expect(result.isEncrypted).toBe(true);
  });

  it("should throw BadRequestError for invalid ID", async () => {
    // Test with invalid ID (NaN)
    await expect(handleRequest(NaN)).rejects.toThrow(BadRequestError);

    // Test with invalid ID (0)
    await expect(handleRequest(0)).rejects.toThrow(BadRequestError);
  });

  it("should throw NotFoundError when config is not found", async () => {
    // Mock the repository to return null (not found)
    getAppConfigByIdMock.mockResolvedValueOnce(null);

    await expect(handleRequest(999)).rejects.toThrow(NotFoundError);
  });
});
