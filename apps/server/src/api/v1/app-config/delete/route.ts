import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Delete app config by id",
  operationId: "delete-app-config-by-id",
  tags: ["App Config"],
  responses: {
    204: {
      description: "Successful deletion",
      content: {
        "application/json": {
          schema: resolver(responseSchema),
        },
      },
    },
    400: {
      description: "Id validation error",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
    404: {
      description: "App config not found",
      content: {
        "application/json": {
          schema: resolver(errorSchema),
        },
      },
    },
  },
};

export default function (app: HonoServer) {
  app.delete(
    "/:id",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("project_admin"),
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    async (c) => {
      const { id } = c.req.valid("param");
      await handleRequest(id);
      return c.body(null, 204);
    }
  );
}
