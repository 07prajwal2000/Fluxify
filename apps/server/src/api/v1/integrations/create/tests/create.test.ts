import { describe, it, expect, mock, spyOn, type Mock } from "bun:test";
import { getAppConfigKeysFromData } from "../service";

describe("getAppConfigKeysFromData()", () => {
  it("should return empty array for non-object config", () => {
    expect(getAppConfigKeysFromData("string")).toEqual([]);
    expect(getAppConfigKeysFromData(null)).toEqual([]);
    expect(getAppConfigKeysFromData(123)).toEqual([]);
  });

  it("should extract cfg: prefixed keys from flat object", () => {
    const config = {
      apiKey: "cfg:MY_API_KEY",
      model: "gpt-4",
    };
    const result = getAppConfigKeysFromData(config);
    expect(result).toEqual(["MY_API_KEY"]);
  });

  it("should extract cfg: prefixed keys from nested objects", () => {
    const config = {
      host: "cfg:DB_HOST",
      credentials: {
        password: "cfg:DB_PASSWORD",
        username: "admin",
      },
    };
    const result = getAppConfigKeysFromData(config);
    expect(result).toContain("DB_HOST");
    expect(result).toContain("DB_PASSWORD");
    expect(result).toHaveLength(2);
  });

  it("should return empty array when no cfg: keys exist", () => {
    const config = {
      apiKey: "sk-1234",
      model: "gpt-4",
      nested: {
        value: "plain",
      },
    };
    const result = getAppConfigKeysFromData(config);
    expect(result).toEqual([]);
  });

  it("should handle deeply nested objects", () => {
    const config = {
      level1: {
        level2: {
          level3: {
            secret: "cfg:DEEP_SECRET",
          },
        },
      },
    };
    const result = getAppConfigKeysFromData(config);
    expect(result).toEqual(["DEEP_SECRET"]);
  });

  it("should handle empty object", () => {
    const result = getAppConfigKeysFromData({});
    expect(result).toEqual([]);
  });
});
