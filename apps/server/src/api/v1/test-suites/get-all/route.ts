import { describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestQuerySchema } from "./dto";
import { errorSchema } from "../../../../errors/customError";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";
import { testSuiteCoreSchema } from "../schema";
import { z } from "zod";

export default function (app: HonoServer) {
  app.get(
    "/",
    describeRoute({
      description: "Gets all test suites for a route.",
      operationId: "get-all-test-suites",
      tags: ["Test Suites"],
      responses: {
        200: {
          description: "Successful",
          content: {
            "application/json": {
              schema: resolver(z.array(testSuiteCoreSchema)),
            },
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
    validator("query", requestQuerySchema, zodErrorCallbackParser),
    async (ctx) => {
      const { route_id } = ctx.req.valid("query");
      const result = await handleRequest(route_id as string);
      return ctx.json(result);
    },
  );
}
