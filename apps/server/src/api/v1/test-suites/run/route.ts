import { describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestRouteSchema, responseSchema } from "./dto";
import { errorSchema } from "../../../../errors/customError";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";

export default function (app: HonoServer) {
  app.post(
    "/:id/run",
    describeRoute({
      description: "Runs a single test suite's assertions.",
      operationId: "run-test-suite",
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
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    async (ctx) => {
      const { id } = ctx.req.valid("param");
      const result = await handleRequest(id);
      return ctx.json(result, result.success ? 200 : 400);
    },
  );
}
