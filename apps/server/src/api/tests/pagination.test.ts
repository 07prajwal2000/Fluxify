import { describe, it, expect, mock, spyOn, type Mock } from "bun:test";
import {
  paginationRequestQuerySchema,
  paginationResponseSchema,
} from "../../lib/pagination";

describe("Pagination Schemas", () => {
  describe("paginationRequestQuerySchema", () => {
    it("should parse valid pagination params", () => {
      const result = paginationRequestQuerySchema.safeParse({
        page: 1,
        perPage: 10,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.perPage).toBe(10);
      }
    });

    it("should apply defaults when not provided", () => {
      const result = paginationRequestQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.perPage).toBe(10);
      }
    });

    it("should coerce string inputs to numbers", () => {
      const result = paginationRequestQuerySchema.safeParse({
        page: "3",
        perPage: "20",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.perPage).toBe(20);
      }
    });

    it("should reject page less than 1", () => {
      const result = paginationRequestQuerySchema.safeParse({
        page: 0,
        perPage: 10,
      });
      expect(result.success).toBe(false);
    });

    it("should reject perPage less than 5", () => {
      const result = paginationRequestQuerySchema.safeParse({
        page: 1,
        perPage: 3,
      });
      expect(result.success).toBe(false);
    });

    it("should reject perPage greater than 50", () => {
      const result = paginationRequestQuerySchema.safeParse({
        page: 1,
        perPage: 100,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("paginationResponseSchema", () => {
    it("should parse valid pagination response", () => {
      const result = paginationResponseSchema.safeParse({
        page: 1,
        totalPages: 5,
        hasNext: true,
      });
      expect(result.success).toBe(true);
    });
  });
});
