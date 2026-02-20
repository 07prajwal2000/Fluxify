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
import { PostgresAdapter } from "@fluxify/adapters";
import { parsePostgresUrl } from "../../../../../lib/parsers/postgres";

// Mock repositories
mock.module("../repository", () => ({
  getAppConfigs: mock(),
}));

// Mock adapters
mock.module("@fluxify/adapters", () => {
  return {
    PostgresAdapter: {
      testConnection: mock(),
    },
    // We mock extractPgConnectionInfo to return specific config or null
    extractPgConnectionInfo: mock(),
    OpenObserve: { TestConnection: mock() },
    LokiLogger: { TestConnection: mock() },
    OpenAIIntegration: { TestConnection: mock() },
    AnthropicIntegration: { TestConnection: mock() },
    GeminiIntegration: { TestConnection: mock() },
    MistralIntegration: { TestConnection: mock() },
    OpenAICompatibleIntegration: { TestConnection: mock() },
  };
});

// Mock parser - Simple mock, we will define return values per test
mock.module("../../../../../lib/parsers/postgres", () => ({
  parsePostgresUrl: mock(),
}));

// Mock encryption
mock.module("../../../../../lib/encryption", () => ({
  EncryptionService: {
    decodeData: mock((val) => val),
    decrypt: mock((val) => val),
  },
}));

// Access mocks
const mockGetAppConfigs = getAppConfigs as unknown as Mock<
  typeof getAppConfigs
>;
const mockPgTestConnection =
  PostgresAdapter.testConnection as unknown as Mock<any>;
const mockParsePostgresUrl = parsePostgresUrl as unknown as Mock<
  typeof parsePostgresUrl
>;

// We need to access extractPgConnectionInfo mock. Since it is not exported from the module directly in the test (we import PostgresAdapter), we might need to grab it from the module mock definition or import it if we could.
// However, since we mock the whole module, we can just grab it if we import it.
import { extractPgConnectionInfo } from "@fluxify/adapters";
const mockExtractPgConnectionInfo =
  extractPgConnectionInfo as unknown as Mock<any>;

describe("testConnection service", () => {
  beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString(
      "base64",
    );
  });

  beforeEach(() => {
    mockGetAppConfigs.mockClear();
    mockPgTestConnection.mockClear();
    mockParsePostgresUrl.mockClear();
    mockExtractPgConnectionInfo.mockClear();

    // Default implementations
    mockGetAppConfigs.mockResolvedValue([]);
    mockPgTestConnection.mockResolvedValue({ success: true });

    // Default parser behavior: return something valid so schema validation passes by default for "url" source checks
    // The schema calls parsePostgresUrl(v). check if null.
    mockParsePostgresUrl.mockReturnValue({} as any);

    // Default extractor behavior: return the config passed to it
    mockExtractPgConnectionInfo.mockImplementation(
      (config: any) => config.config || config,
    );
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

  it("should return error for invalid config (schema validation)", async () => {
    // Force schema validation fail for URL
    mockParsePostgresUrl.mockReturnValue(null); // Schema check fails

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { source: "url", url: "invalid-url" },
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
    mockParsePostgresUrl.mockReturnValue(null); // Invalid URL

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { source: "url", url: "not-a-valid-postgres-url" },
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

    // Schema validation passes for cfg: because of refine rule (startsWith cfg)
    // mockParsePostgresUrl not called for cfg: string

    // mockExtractPgConnectionInfo needs to return something valid
    mockExtractPgConnectionInfo.mockReturnValue({ connectionString: "..." });

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { source: "url", url: "cfg:db_url" },
    });

    expect(mockGetAppConfigs).toHaveBeenCalledWith(["db_url"]);
    expect(result.success).toBe(true);
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

    mockExtractPgConnectionInfo.mockReturnValue({ connectionString: "..." });

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: {
        source: "url",
        url: "cfg:db_password",
      },
    });

    expect(mockGetAppConfigs).toHaveBeenCalledWith(["db_password"]);
    expect(result.success).toBe(true);
  });

  it("should return error for missing required config fields", async () => {
    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { host: "localhost" }, // Missing url/source
    });

    expect(result.success).toBe(false);
  });

  it("should parse PostgreSQL connection string correctly", async () => {
    mockParsePostgresUrl.mockReturnValue({ host: "localhost" } as any); // Valid

    // extractPgConnectionInfo is called in service.
    // We want to verify that extractPgConnectionInfo calls were made correctly OR just that logic proceeded.
    // Logic: if (!pgConfig) return error.
    mockExtractPgConnectionInfo.mockReturnValue({
      host: "localhost",
      user: "user",
    });

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: {
        source: "url",
        url: "postgres://user:pass@localhost:5432/testdb",
      },
    });

    expect(result.success).toBe(true);
    expect(mockParsePostgresUrl).toHaveBeenCalledWith(
      "postgres://user:pass@localhost:5432/testdb",
    );
  });

  it("should fail if extractPgConnectionInfo returns null (invalid config after processing)", async () => {
    mockParsePostgresUrl.mockReturnValue({} as any); // Schema passes
    mockExtractPgConnectionInfo.mockReturnValue(null); // Extraction fails

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { source: "url", url: "postgres://valid" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid configuration");
  });
});
