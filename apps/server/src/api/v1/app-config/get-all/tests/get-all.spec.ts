import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockInstance,
} from "vitest";
import { getAppConfigList } from "../repository";
import { responseSchema } from "../dto";
import handleRequest from "../service";

// Mock the repository
vi.mock("../repository");

describe("getAllAppConfig service", () => {
  const mockConfigs = [
    {
      id: 1,
      keyName: "test.key.1",
      isEncrypted: false,
      encodingType: "plaintext",
      createdAt: new Date("2023-01-01T00:00:00.000Z"),
      updatedAt: new Date("2023-01-01T00:00:00.000Z"),
    },
    {
      id: 2,
      keyName: "test.key.2",
      isEncrypted: true,
      encodingType: "plaintext",
      createdAt: new Date("2023-01-02T00:00:00.000Z"),
      updatedAt: new Date("2023-01-02T00:00:00.000Z"),
    },
  ] as const;

  let getAppConfigListMock: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    getAppConfigListMock = vi.mocked(getAppConfigList);
  });

  it("should return all app configs with correct structure", async () => {
    // Mock the repository response
    getAppConfigListMock.mockResolvedValueOnce({
      result: JSON.parse(JSON.stringify(mockConfigs)).map((item: any) => ({
        ...item,
        dataType: "string",
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      })),
      totalCount: 2,
    });

    const result = await handleRequest({
      page: 1,
      perPage: 10,
    });

    // Verify the response matches the schema
    expect(() => responseSchema.parse(result)).not.toThrow();

    // Verify the structure of the response
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("pagination");
    expect(Array.isArray(result.data)).toBe(true);

    // Verify all required fields are present in each config item
    result.data.forEach((config) => {
      expect(config).toHaveProperty("id");
      expect(config).toHaveProperty("keyName");
      expect(config).toHaveProperty("isEncrypted");
      expect(config).toHaveProperty("encodingType");
      expect(config).toHaveProperty("createdAt");
      expect(config).toHaveProperty("updatedAt");

      // Verify dates are properly formatted as ISO strings
      expect(() => new Date(config.createdAt)).not.toThrow();
      expect(() => new Date(config.updatedAt)).not.toThrow();
    });
  });

  it("should return correct pagination metadata", async () => {
    const totalCount = 15;
    const page = 2;
    const perPage = 5;

    getAppConfigListMock.mockResolvedValueOnce({
      result: Array(perPage)
        .fill(mockConfigs[0])
        .map((item: any) => ({
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })),
      totalCount,
    });

    const result = await handleRequest({
      page,
      perPage,
    });

    expect(result.pagination).toEqual({
      hasNext: true,
      page,
      totalPages: Math.ceil(totalCount / perPage),
    });
  });

  it("should handle empty results", async () => {
    getAppConfigListMock.mockResolvedValueOnce({
      result: [],
      totalCount: 0,
    });

    const result = await handleRequest({
      page: 1,
      perPage: 10,
    });

    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      hasNext: false,
      page: 1,
      totalPages: 0,
    });
  });
});
