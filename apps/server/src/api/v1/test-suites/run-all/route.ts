import { describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestQuerySchema, responseSchema } from "./dto";
import { errorSchema } from "../../../../errors/customError";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";

export default function (app: HonoServer) {
  app.post(
    "/run-all",
    describeRoute({
      description: "Runs all test suites for a route.",
      operationId: "run-all-test-suites",
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
    validator("query", requestQuerySchema, zodErrorCallbackParser),
    async (ctx) => {
      const { route_id } = ctx.req.valid("query");
      const result = await handleRequest(route_id as string);
      return ctx.json(result, result.success ? 200 : 400);
    },
  );
}
