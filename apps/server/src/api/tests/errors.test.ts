import { describe, it, expect, mock, spyOn, type Mock } from "bun:test";
import { NotFoundError } from "../../errors/notFoundError";
import { ConflictError } from "../../errors/conflictError";
import { ForbiddenError } from "../../errors/forbidError";
import { BadRequestError } from "../../errors/badRequestError";
import { ServerError } from "../../errors/serverError";

describe("Custom Error Classes", () => {
  describe("NotFoundError", () => {
    it("should have httpCode 404", () => {
      const err = new NotFoundError("Not found");
      expect(err.httpCode).toBe(404);
      expect(err.message).toBe("Not found");
    });

    it("should return regular type error data", () => {
      const err = new NotFoundError("Resource missing");
      const data = err.getError() as any;
      expect(data.type).toBe("regular");
      expect(data.message).toBe("Resource missing");
    });
  });

  describe("ConflictError", () => {
    it("should have httpCode 409", () => {
      const err = new ConflictError("Duplicate entry");
      expect(err.httpCode).toBe(409);
      expect(err.message).toBe("Duplicate entry");
    });
  });

  describe("ForbiddenError", () => {
    it("should have httpCode 403", () => {
      const err = new ForbiddenError();
      expect(err.httpCode).toBe(403);
      expect(err.message).toBe("Access denied");
    });

    it("should accept custom message", () => {
      const err = new ForbiddenError("You shall not pass");
      expect(err.message).toBe("You shall not pass");
    });

    it("should return auth type error data", () => {
      const err = new ForbiddenError();
      const data = err.getError() as any;
      expect(data.type).toBe("auth");
    });
  });

  describe("BadRequestError", () => {
    it("should have httpCode 400", () => {
      const err = new BadRequestError("Invalid input");
      expect(err.httpCode).toBe(400);
      expect(err.message).toBe("Invalid input");
    });
  });

  describe("ServerError", () => {
    it("should have httpCode 500", () => {
      const err = new ServerError("Internal error");
      expect(err.httpCode).toBe(500);
      expect(err.message).toBe("Internal error");
    });
  });

  describe("Error inheritance", () => {
    it("all custom errors should be instances of Error", () => {
      expect(new NotFoundError("test")).toBeInstanceOf(Error);
      expect(new ConflictError("test")).toBeInstanceOf(Error);
      expect(new ForbiddenError()).toBeInstanceOf(Error);
      expect(new BadRequestError("test")).toBeInstanceOf(Error);
      expect(new ServerError("test")).toBeInstanceOf(Error);
    });
  });
});
