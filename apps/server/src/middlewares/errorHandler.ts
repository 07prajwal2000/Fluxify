import { Context, Hono } from "hono";
import { HttpError } from "../errors/httpError";
import { type ContentfulStatusCode } from "hono/utils/http-status";
import { CustomError } from "../errors/customError";
import { ValidationError } from "../errors/validationError";
import { APIError } from "better-auth";
import { logger } from "@fluxify/common";

export function errorHandler(error: any, c: Context) {
  if (error instanceof CustomError) {
    const errorType = error.getError().type;
    if (error instanceof ValidationError) {
      return c.json(
        { errors: error.errors, type: errorType },
        error.httpCode as ContentfulStatusCode
      );
    }
    return c.json(
      { message: error.message, type: errorType },
      error.httpCode as ContentfulStatusCode
    );
  }
  if (error.toString().includes("Malformed JSON")) {
    return c.json(
      {
        message: "Invalid JSON",
        type: "validation",
      },
      400
    );
  }

  if (error instanceof APIError) {
    const isAuthError = error.statusCode === 401 || error.statusCode === 403;
    return c.json(
      {
        message: error.message,
        type: isAuthError ? "auth_error" : "regular",
      },
      error.statusCode as ContentfulStatusCode
    );
  }

  // Handle other types of errors
  logger.error("Unhandled error", "errorHandler", { error });
  return c.json(
    { message: "Unknown server error occured", type: "server_error" },
    500
  );
}

// Helper function to create HttpError instances
export { HttpError };
