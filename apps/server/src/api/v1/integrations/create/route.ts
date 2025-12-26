import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { errorSchema } from "../../../../errors/customError";
import { requestBodyValidator } from "./middleware";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Create integration",
  operationId: "create-integration",
  tags: ["Integrations"],
  responses: {
    200: {
      description: "Successful",
      content: {
        "application/json": {
          schema: resolver(responseSchema),
        },
      },
    },
    404: {
      description: "Invalid request / App config key not found",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
    409: {
      description: "Integration already exists",
      content: {
        "application/json": {
          schema: resolver(errorSchema),
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: resolver(errorSchema),
        },
      },
    },
  },
};

export default function (app: HonoServer) {
  app.post(
    "/",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("creator"),
    validator("json", requestBodySchema, zodErrorCallbackParser),
    requestBodyValidator,
    async (c) => {
      const data = c.req.valid("json");
      const config = c.get("config" as never) as any;
      data.config = config;
      const result = await handleRequest(data);
      return c.json(result, 201);
    }
  );
}
