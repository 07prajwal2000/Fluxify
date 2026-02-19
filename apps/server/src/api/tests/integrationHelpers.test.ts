import { describe, it, expect, mock, spyOn, type Mock } from "bun:test";
import {
  getIntegrationsGroups,
  getIntegrationsVariants,
  getDefaultVariantValue,
  getSchema,
} from "../v1/integrations/helpers";
import {
  integrationsGroupSchema,
  postgresVariantConfigSchema,
  openObserveVariantConfigSchema,
  openAIVariantConfigSchema,
  openAiCompatibleVariantConfigSchema,
} from "../v1/integrations/schemas";

describe("Integration Helpers", () => {
  describe("getIntegrationsGroups()", () => {
    it("should return all integration group types", () => {
      const groups = getIntegrationsGroups();
      expect(groups).toContain("database");
      expect(groups).toContain("kv");
      expect(groups).toContain("ai");
      expect(groups).toContain("baas");
      expect(groups).toContain("observability");
    });
  });

  describe("getIntegrationsVariants()", () => {
    it("should return database variants", () => {
      const variants = getIntegrationsVariants("database");
      expect(variants).toContain("PostgreSQL");
    });

    it("should return observability variants", () => {
      const variants = getIntegrationsVariants("observability");
      expect(variants).toContain("Open Observe");
      expect(variants).toContain("Loki");
    });

    it("should return AI variants", () => {
      const variants = getIntegrationsVariants("ai");
      expect(variants).toContain("OpenAI");
      expect(variants).toContain("Anthropic");
      expect(variants).toContain("Gemini");
    });

    it("should return empty array for unknown groups", () => {
      const variants = getIntegrationsVariants("kv");
      expect(variants).toEqual([]);
    });
  });

  describe("getDefaultVariantValue()", () => {
    it("should return default PostgreSQL config", () => {
      const config = getDefaultVariantValue("PostgreSQL") as any;
      expect(config).not.toBeNull();
      expect(config.source).toBe("credentials");
      expect(config.host).toBe("");
    });

    it("should return default Open Observe config", () => {
      const config = getDefaultVariantValue("Open Observe") as any;
      expect(config).not.toBeNull();
      expect(config.baseUrl).toBe("");
      expect(config.credentials).toBeDefined();
    });

    it("should return default OpenAI config", () => {
      const config = getDefaultVariantValue("OpenAI") as any;
      expect(config).not.toBeNull();
      expect(config.apiKey).toBe("");
      expect(config.model).toBe("");
    });

    it("should return default OpenAI Compatible config", () => {
      const config = getDefaultVariantValue("OpenAI Compatible") as any;
      expect(config).not.toBeNull();
      expect(config.baseUrl).toBe("");
    });

    it("should return null for unsupported variants", () => {
      expect(getDefaultVariantValue("Redis" as any)).toBeNull();
    });
  });

  describe("getSchema()", () => {
    it("should return PostgreSQL schema for database+PostgreSQL", () => {
      const schema = getSchema("database", "PostgreSQL");
      expect(schema).not.toBeNull();
    });

    it("should return null for unsupported database variant", () => {
      const schema = getSchema("database", "MySQL");
      expect(schema).toBeNull();
    });

    it("should return null for invalid variant", () => {
      const schema = getSchema("database", "FakeDB");
      expect(schema).toBeNull();
    });

    it("should return OpenAI schema for ai+OpenAI", () => {
      const schema = getSchema("ai", "OpenAI");
      expect(schema).not.toBeNull();
    });

    it("should return schema for observability variants", () => {
      expect(getSchema("observability", "Open Observe")).not.toBeNull();
      expect(getSchema("observability", "Loki")).not.toBeNull();
    });

    it("should return null for unsupported kv variant", () => {
      const schema = getSchema("kv", "Redis");
      expect(schema).toBeNull();
    });
  });
});
