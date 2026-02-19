import { describe, it, expect, mock, spyOn, type Mock } from "bun:test";
import { parsePostgresUrl } from "../../lib/parsers/postgres";

describe("parsePostgresUrl()", () => {
  it("should parse a standard postgres URL", () => {
    const result = parsePostgresUrl(
      "postgres://admin:secret@localhost:5432/mydb",
    );
    expect(result).not.toBeNull();
    expect(result!.username).toBe("admin");
    expect(result!.password).toBe("secret");
    expect(result!.host).toBe("localhost");
    expect(result!.port).toBe(5432);
    expect(result!.database).toBe("mydb");
    expect(result!.ssl).toBe(false);
  });

  it("should parse URL with ssl=true", () => {
    const result = parsePostgresUrl(
      "postgres://user:pass@host:5433/db?ssl=true",
    );
    expect(result).not.toBeNull();
    expect(result!.ssl).toBe(true);
  });

  it("should parse URL with ssl=1", () => {
    const result = parsePostgresUrl("postgres://user:pass@host:5432/db?ssl=1");
    expect(result).not.toBeNull();
    expect(result!.ssl).toBe(true);
  });

  it("should parse URL with ssl=false", () => {
    const result = parsePostgresUrl(
      "postgres://user:pass@host:5432/db?ssl=false",
    );
    expect(result).not.toBeNull();
    expect(result!.ssl).toBe(false);
  });

  it("should return null for invalid URL format", () => {
    expect(parsePostgresUrl("not-a-url")).toBeNull();
    expect(parsePostgresUrl("mysql://user:pass@host:3306/db")).toBeNull();
    expect(parsePostgresUrl("postgres://")).toBeNull();
    expect(parsePostgresUrl("")).toBeNull();
  });

  it("should handle special characters in password", () => {
    // Note: the regex doesn't enforce URL-encoding
    const result = parsePostgresUrl(
      "postgres://user:p%40ssw0rd@db.example.com:5432/production",
    );
    expect(result).not.toBeNull();
    expect(result!.password).toBe("p%40ssw0rd");
    expect(result!.host).toBe("db.example.com");
  });
});
