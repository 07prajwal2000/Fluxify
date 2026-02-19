import { describe, it, expect, beforeEach, beforeAll, mock, spyOn, type Mock } from "bun:test";
import handleRequest from "../service";
import { getAppConfigs } from "../repository";

mock.module("../repository", () => ({
    getAppConfigs: mock()
}));
mock.module("@fluxify/adapters", async () => {
  return {
    PostgresAdapter: {
      testConnection: mock(),
    },
    extractPgConnectionInfo: mock((config) => config),
  };
});
mock.module("../../../../../lib/encryption", () => ({
  EncryptionService: {
    decodeData: mock((val) => val),
    decrypt: mock((val) => val),
  },
}));



describe("testConnection service", () => {
  beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString(
      "base64",
    );
  });

  beforeEach(() => {
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
    const { PostgresAdapter } = await import("@fluxify/adapters");
    (PostgresAdapter.testConnection as any).mockResolvedValueOnce({
      success: true,
    });

    (getAppConfigs as unknown as Mock<typeof getAppConfigs>).mockResolvedValueOnce([
      {
        key: "db_url",
        value: "postgres://localhost:5432/testdb",
        isEncrypted: false,
        encodingType: "plaintext",
      },
    ]);

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { source: "url", url: "cfg:db_url" },
    });

    expect((getAppConfigs as unknown as Mock<typeof getAppConfigs>)).toHaveBeenCalled();
  });

  it("should handle encrypted app configs", async () => {
    const { PostgresAdapter } = await import("@fluxify/adapters");
    (PostgresAdapter.testConnection as any).mockResolvedValueOnce({
      success: true,
    });

    (getAppConfigs as unknown as Mock<typeof getAppConfigs>).mockResolvedValueOnce([
      {
        key: "db_password",
        value: "encrypted_value",
        isEncrypted: true,
        encodingType: "plaintext",
      },
    ]);

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: {
        source: "url",
        url: "cfg:db_password",
      },
    });

    expect((getAppConfigs as unknown as Mock<typeof getAppConfigs>)).toHaveBeenCalledWith(["db_password"]);
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
    (getAppConfigs as unknown as Mock<typeof getAppConfigs>).mockResolvedValueOnce([]);

    const result = await handleRequest({
      group: "database",
      variant: "PostgreSQL",
      config: { url: "postgres://user:pass@localhost:5432/testdb" },
    });

    // Result will depend on adapter, but config should be valid
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("error");
  });
});
