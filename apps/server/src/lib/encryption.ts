import crypto from "crypto";
import { getEnv } from "./env";

// AES-256-GCM encryption/decryption utilities
export class EncryptionService {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 16; // 128 bits
  private static readonly AUTH_TAG_LENGTH = 16; // 128 bits

  private static getMasterKey(): Buffer {
    const key = getEnv("MASTER_ENCRYPTION_KEY");
    if (!key) {
      throw new Error("MASTER_ENCRYPTION_KEY environment variable is not set");
    }

    // Decode base64 key and ensure it's 32 bytes
    const decodedKey = Buffer.from(key, "base64");
    if (decodedKey.length !== this.KEY_LENGTH) {
      throw new Error(
        "MASTER_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
      );
    }

    return decodedKey;
  }

  /**
   * Encrypts plaintext using AES-256-GCM
   * @param plaintext - The text to encrypt
   * @returns Base64-encoded encrypted data with IV and auth tag
   */
  static encrypt(plaintext: string): string {
    const key = this.getMasterKey();
    const iv = crypto.randomBytes(this.IV_LENGTH);

    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from("")); // Additional authenticated data

    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");

    const authTag = cipher.getAuthTag();

    // Combine IV + Auth Tag + Encrypted Data
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, "base64"),
    ]);

    return combined.toString("base64");
  }

  /**
   * Decrypts AES-256-GCM encrypted data
   * @param encryptedData - Base64-encoded encrypted data with IV and auth tag
   * @returns Decrypted plaintext
   */
  static decrypt(encryptedData: string): string {
    const key = this.getMasterKey();
    const combined = Buffer.from(encryptedData, "base64");

    if (combined.length < this.IV_LENGTH + this.AUTH_TAG_LENGTH) {
      throw new Error("Invalid encrypted data format");
    }

    const iv = combined.subarray(0, this.IV_LENGTH);
    const authTag = combined.subarray(
      this.IV_LENGTH,
      this.IV_LENGTH + this.AUTH_TAG_LENGTH
    );
    const encrypted = combined.subarray(this.IV_LENGTH + this.AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(""));
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Masks sensitive data for display purposes
   * @param value - The value to mask
   * @param maskChar - Character to use for masking (default: '*')
   * @param visibleChars - Number of characters to show at start and end (default: 4)
   * @returns Masked string
   */
  static maskValue(value: string, maskChar: string = "*"): string {
    return maskChar.repeat(value.length);
  }

  /**
   * Validates if a string is valid base64
   * @param str - String to validate
   * @returns True if valid base64, false otherwise
   */
  static isValidBase64(str: string): boolean {
    try {
      return Buffer.from(str, "base64").toString("base64") === str;
    } catch {
      return false;
    }
  }

  /**
   * Encodes data according to the specified encoding type
   * @param data - Data to encode
   * @param encodingType - Type of encoding ('plaintext', 'base64', 'hex')
   * @returns Encoded data
   */
  static encodeData(
    data: string,
    encodingType: "plaintext" | "base64" | "hex"
  ): string {
    switch (encodingType) {
      case "plaintext":
        return data;
      case "base64":
        return Buffer.from(data, "utf8").toString("base64");
      case "hex":
        return Buffer.from(data, "utf8").toString("hex");
      default:
        throw new Error(`Unsupported encoding type: ${encodingType}`);
    }
  }

  /**
   * Decodes data according to the specified encoding type
   * @param data - Data to decode
   * @param encodingType - Type of encoding ('plaintext', 'base64', 'hex')
   * @returns Decoded data
   */
  static decodeData(
    data: string,
    encodingType: "plaintext" | "base64" | "hex"
  ): string {
    switch (encodingType) {
      case "plaintext":
        return data;
      case "base64":
        return Buffer.from(data, "base64").toString("utf8");
      case "hex":
        return Buffer.from(data, "hex").toString("utf8");
      default:
        throw new Error(`Unsupported encoding type: ${encodingType}`);
    }
  }
}
