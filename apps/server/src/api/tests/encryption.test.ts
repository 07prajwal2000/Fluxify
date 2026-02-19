import { describe, it, expect, mock, spyOn, type Mock } from "bun:test";
import { EncryptionService } from "../../lib/encryption";

describe("EncryptionService", () => {
  describe("encodeData()", () => {
    it("should return plaintext as-is for 'plaintext' encoding", () => {
      expect(EncryptionService.encodeData("hello", "plaintext")).toBe("hello");
    });

    it("should encode to base64", () => {
      const encoded = EncryptionService.encodeData("hello world", "base64");
      expect(encoded).toBe(Buffer.from("hello world").toString("base64"));
    });

    it("should encode to hex", () => {
      const encoded = EncryptionService.encodeData("hello", "hex");
      expect(encoded).toBe(Buffer.from("hello").toString("hex"));
    });
  });

  describe("decodeData()", () => {
    it("should return plaintext as-is for 'plaintext' encoding", () => {
      expect(EncryptionService.decodeData("hello", "plaintext")).toBe("hello");
    });

    it("should decode from base64", () => {
      const base64 = Buffer.from("test string").toString("base64");
      expect(EncryptionService.decodeData(base64, "base64")).toBe(
        "test string",
      );
    });

    it("should decode from hex", () => {
      const hex = Buffer.from("test data").toString("hex");
      expect(EncryptionService.decodeData(hex, "hex")).toBe("test data");
    });

    it("should round-trip encode/decode for base64", () => {
      const original = "sensitive data 123!@#";
      const encoded = EncryptionService.encodeData(original, "base64");
      const decoded = EncryptionService.decodeData(encoded, "base64");
      expect(decoded).toBe(original);
    });

    it("should round-trip encode/decode for hex", () => {
      const original = "another secret value";
      const encoded = EncryptionService.encodeData(original, "hex");
      const decoded = EncryptionService.decodeData(encoded, "hex");
      expect(decoded).toBe(original);
    });
  });

  describe("maskValue()", () => {
    it("should mask the entire value with default char", () => {
      const masked = EncryptionService.maskValue("password123");
      expect(masked).toBe("***********");
      expect(masked.length).toBe("password123".length);
    });

    it("should mask with custom character", () => {
      const masked = EncryptionService.maskValue("secret", "X");
      expect(masked).toBe("XXXXXX");
    });
  });

  describe("isValidBase64()", () => {
    it("should return true for valid base64 strings", () => {
      const valid = Buffer.from("hello").toString("base64");
      expect(EncryptionService.isValidBase64(valid)).toBe(true);
    });

    it("should return false for invalid base64 strings", () => {
      expect(EncryptionService.isValidBase64("not-valid-b64!!!")).toBe(false);
    });
  });
});
