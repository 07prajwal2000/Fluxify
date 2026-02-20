import { describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestBodySchema, responseSchema } from "./dto";
import { errorSchema } from "../../../../errors/customError";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";

export default function (app: HonoServer) {
  app.post(
    "/",
    describeRoute({
      description: "Creates a new test suite.",
      operationId: "create-test-suite",
      tags: ["Test Suites"],
      responses: {
        200: {
          description: "Successful",
          content: { "application/json": { schema: resolver(responseSchema) } },
        },
        400: {
          description: "Invalid data",
          content: {
            "application/json": { schema: resolver(validationErrorSchema) },
          },
        },
        409: {
          description: "Error",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
      },
    }),
    requireTestSuiteAccess("creator"),
    validator("json", requestBodySchema, zodErrorCallbackParser),
    async (ctx) => {
      const data = ctx.req.valid("json");
      const result = await handleRequest(data);
      return ctx.json(result);
    },
  );
}
