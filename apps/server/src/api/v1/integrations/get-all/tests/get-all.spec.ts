import { describe, it, expect, beforeEach, mock, spyOn, type Mock } from "bun:test";
import handleRequest from "../service";
import { getAllIntegrationsByGroup } from "../repository";

mock.module("../repository", () => ({
    getAllIntegrationsByGroup: mock()
}));



describe("getAllIntegrations service", () => {
  beforeEach(() => {
  });

  it("should return all integrations for a given group", async () => {
    const mockIntegrations = [
      {
        id: "1",
        name: "postgres-prod",
        group: "database",
        variant: "PostgreSQL",
        config: { url: "postgres://prod" },
      },
      {
        id: "2",
        name: "postgres-dev",
        group: "database",
        variant: "PostgreSQL",
        config: { url: "postgres://dev" },
      },
    ];

    (getAllIntegrationsByGroup as unknown as Mock<typeof getAllIntegrationsByGroup>).mockResolvedValueOnce(mockIntegrations as any);

    const result = await handleRequest("database");

    expect((getAllIntegrationsByGroup as unknown as Mock<typeof getAllIntegrationsByGroup>)).toHaveBeenCalledWith("database");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "1",
      name: "postgres-prod",
      group: "database",
      variant: "PostgreSQL",
      config: { url: "postgres://prod" },
    });
  });

  it("should return empty array when no integrations exist for group", async () => {
    (getAllIntegrationsByGroup as unknown as Mock<typeof getAllIntegrationsByGroup>).mockResolvedValueOnce([]);

    const result = await handleRequest("kv");

    expect(result).toEqual([]);
    expect((getAllIntegrationsByGroup as unknown as Mock<typeof getAllIntegrationsByGroup>)).toHaveBeenCalledWith("kv");
  });

  it("should handle different groups", async () => {
    const groups = ["database", "kv", "ai", "baas"];

    for (const group of groups) {
      (getAllIntegrationsByGroup as unknown as Mock<typeof getAllIntegrationsByGroup>).mockResolvedValueOnce([]);
      await handleRequest(group);
      expect((getAllIntegrationsByGroup as unknown as Mock<typeof getAllIntegrationsByGroup>)).toHaveBeenCalledWith(group);
    }
  });

  it("should map integration properties correctly", async () => {
    const mockIntegration = {
      id: "test-id",
      name: "test-integration",
      group: "database",
      variant: "PostgreSQL",
      config: { url: "postgres://localhost", ssl: true },
    };

    (getAllIntegrationsByGroup as unknown as Mock<typeof getAllIntegrationsByGroup>).mockResolvedValueOnce([mockIntegration] as any);

    const result = await handleRequest("database");

    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("group");
    expect(result[0]).toHaveProperty("variant");
    expect(result[0]).toHaveProperty("config");
  });
});