import { describe, it, expect, mock, spyOn, type Mock } from "bun:test";
import {
  getIntegrationsGroups,
  getIntegrationsVariants,
  getDefaultVariantValue,
  getSchema,
} from "../v1/integrations/helpers";
import {
  integrationsGroupSchema,
  getIntegrationTags,
  postgresVariantConfigSchema,
  openTelemetryLogsVariantConfigSchema,
  openAIVariantConfigSchema,
  openAiCompatibleVariantConfigSchema,
} from "../v1/integrations/schemas";

describe("Integration Helpers", () => {
  // The client filters the integration picker by these tags, so an empty list
  // means the integration cannot be selected at all. Every OTEL integration used
  // to return [] — the branch tested a variant name that was not in the enum.
  describe("getIntegrationTags()", () => {
    it("gives an OTEL integration all three signal tags", () => {
      const tags = getIntegrationTags("observability", "Open Telemetry");
      expect(tags.sort()).toEqual(["logs", "metrics", "traces"]);
    });

    it("gives stored rows on the legacy variant the same tags", () => {
      expect(getIntegrationTags("observability", "Open Telemetry Logs").sort()).toEqual(
        ["logs", "metrics", "traces"],
      );
    });

    it("keeps Loki logs-only", () => {
      expect(getIntegrationTags("observability", "Loki")).toEqual(["logs"]);
    });

    it("returns nothing for an unknown variant", () => {
      expect(getIntegrationTags("observability", "Splunk")).toEqual([]);
    });
  });

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
      expect(variants).toContain("Open Telemetry");
      // the legacy name must NOT be offered — it is accepted on stored rows only
      expect(variants).not.toContain("Open Telemetry Logs");
      expect(variants).toContain("Loki");
    });

    it("should return AI variants", () => {
      const variants = getIntegrationsVariants("ai");
      expect(variants).toContain("OpenAI");
      expect(variants).toContain("Anthropic");
      expect(variants).toContain("Gemini");
    });

    it("should return kv variants", () => {
      const variants = getIntegrationsVariants("kv");
      expect(variants).toContain("Redis");
      expect(variants).toContain("Memcached");
    });

    it("should return empty array for unknown groups", () => {
      const variants = getIntegrationsVariants("unknown_group" as any);
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

    it("should return default Open Telemetry config", () => {
      const config = getDefaultVariantValue("Open Telemetry") as any;
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

    it("should return default Redis config", () => {
      const config = getDefaultVariantValue("Redis") as any;
      expect(config).not.toBeNull();
      expect(config.source).toBe("credentials");
    });

    it("should return null for unsupported variants", () => {
      expect(getDefaultVariantValue("FakeVariant" as any)).toBeNull();
    });
  });

  describe("getSchema()", () => {
    it("should return PostgreSQL schema for database+PostgreSQL", () => {
      const schema = getSchema("database", "PostgreSQL");
      expect(schema).not.toBeNull();
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
      expect(getSchema("observability", "Open Telemetry")).not.toBeNull();
      // stored rows still carrying the old variant must resolve to the same schema
      expect(getSchema("observability", "Open Telemetry Logs")).not.toBeNull();
      expect(getSchema("observability", "Loki")).not.toBeNull();
    });

    it("should return schema for kv variants", () => {
      const schema = getSchema("kv", "Redis");
      expect(schema).not.toBeNull();
    });
  });
});
