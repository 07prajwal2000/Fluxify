import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Delete multiple app configs by ids",
  operationId: "delete-app-configs-bulk",
  tags: ["App Config"],
  responses: {
    200: {
      description: "Successful deletion",
      content: {
        "application/json": {
          schema: resolver(responseSchema),
        },
      },
    },
    400: {
      description: "Validation/Regular Error",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
  },
};

export default function (app: HonoServer) {
  app.post(
    "/delete-bulk",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("project_admin"),
    validator("json", requestBodySchema, zodErrorCallbackParser),
    async (c) => {
      const body = c.req.valid("json");
      await handleRequest(body);
      return c.body(null, 200);
    }
  );
}
