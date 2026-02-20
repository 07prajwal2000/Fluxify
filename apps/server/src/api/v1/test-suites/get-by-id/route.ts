import { describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestRouteSchema } from "./dto";
import { errorSchema } from "../../../../errors/customError";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";
import { testSuiteCoreSchema } from "../schema";

export default function (app: HonoServer) {
  app.get(
    "/:id",
    describeRoute({
      description: "Gets a test suite.",
      operationId: "get-test-suite",
      tags: ["Test Suites"],
      responses: {
        200: {
          description: "Successful",
          content: {
            "application/json": { schema: resolver(testSuiteCoreSchema) },
          },
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
    requireTestSuiteAccess("viewer"),
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    async (ctx) => {
      const { id } = ctx.req.valid("param");
      const result = await handleRequest(id);
      return ctx.json(result);
    },
  );
}
