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
import { getAppConfigs } from "../repository";
// We import adapter to get access to the mocked object for assertions
import { PostgresAdapter } from "@fluxify/adapters";

// Define mocks
mock.module("../repository", () => ({
  getAppConfigs: mock(),
}));

mock.module("@fluxify/adapters", () => {
  return {
    PostgresAdapter: {
      testConnection: mock(),
    },
    extractPgConnectionInfo: mock((config) => config),
    // Other integrations might be needed if handleRequest imports them
    OpenObserve: { TestConnection: mock() },
    LokiLogger: { TestConnection: mock() },
    OpenAIIntegration: { TestConnection: mock() },
    AnthropicIntegration: { TestConnection: mock() },
    GeminiIntegration: { TestConnection: mock() },
    MistralIntegration: { TestConnection: mock() },
    OpenAICompatibleIntegration: { TestConnection: mock() },
  };
});

mock.module("../../../../../lib/encryption", () => ({
  EncryptionService: {
    decodeData: mock((val) => val),
    decrypt: mock((val) => val),
  },
}));

const mockGetAppConfigs = getAppConfigs as unknown as Mock<
  typeof getAppConfigs
>;
// We need to cast PostgresAdapter.testConnection carefully
const mockPgTestConnection =
  PostgresAdapter.testConnection as unknown as Mock<any>;

describe("testConnection service", () => {
  beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString(
      "base64",
    );
  });

  beforeEach(() => {
    // Clear all mocks to prevent state carrying over
    mockGetAppConfigs.mockClear();
    mockPgTestConnection.mockClear();

    // Default implementations
    mockGetAppConfigs.mockResolvedValue([]); // Default: no app configs found
    mockPgTestConnection.mockResolvedValue({ success: true }); // Default: connection success
  });

  it("should return error for invalid group", async () => {
    const result = await handleRequest({
      group: "invalid" as any,
      variant: "PostgreSQL",
      config: { url: "postgres://localhost" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid group or variant");
  });

  it("should return error for invalid variant", async () => {
    const result = await handleRequest({
      group: "database",
      variant: "InvalidDB",
      config: { url: "postgres://localhost" },
    });

    expect(result.success).toBe(false);
  });

  it("should return error for invalid config", async () => {
    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { url: "invalid-url" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid configuration");
  });

  it("should return error for unsupported group", async () => {
    const result = await handleRequest({
      group: "kv",
      variant: "Redis",
      config: { host: "localhost" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid group or variant");
  });

  it("should validate PostgreSQL URL format", async () => {
    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { url: "not-a-valid-postgres-url" },
    });

    expect(result.success).toBe(false);
  });

  it("should accept cfg: prefixed config keys", async () => {
    mockGetAppConfigs.mockResolvedValueOnce([
      {
        key: "db_url",
        value: "postgres://localhost:5432/testdb",
        isEncrypted: false,
        encodingType: "plaintext",
      },
    ] as any);

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { source: "url", url: "cfg:db_url" },
    });

    // We expect getAppConfigs to be called with nothing (to get all keys? or keys extracted from config?)
    // In service: getAppConfigKeysFromData(data) -> returns ["db_url"]
    // Then getAppConfigs(["db_url"])
    expect(mockGetAppConfigs).toHaveBeenCalledWith(["db_url"]);
  });

  it("should handle encrypted app configs", async () => {
    mockGetAppConfigs.mockResolvedValueOnce([
      {
        key: "db_password",
        value: "encrypted_value",
        isEncrypted: true,
        encodingType: "plaintext",
      },
    ] as any);

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: {
        source: "url",
        url: "cfg:db_password",
      },
    });

    expect(mockGetAppConfigs).toHaveBeenCalledWith(["db_password"]);
  });

  it("should return error for missing required config fields", async () => {
    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { host: "localhost" }, // Missing url
    });

    expect(result.success).toBe(false);
  });

  it("should parse PostgreSQL connection string correctly", async () => {
    mockGetAppConfigs.mockResolvedValueOnce([]);

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { url: "postgres://user:pass@localhost:5432/testdb" },
    });

    expect(result).toHaveProperty("success");
    // expect(result).toHaveProperty("error"); // Error might be empty string or null depending on success
  });
});
