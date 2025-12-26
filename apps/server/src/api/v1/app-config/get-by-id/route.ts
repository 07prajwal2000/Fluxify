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
import { validationErrorSchema } from "../../../../errors/validationError";
import { errorSchema } from "../../../../errors/customError";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Get app config by id",
  operationId: "get-app-config-by-id",
  tags: ["App Config"],
  responses: {
    200: {
      description: "Successful",
      content: {
        "application/json": {
          schema: resolver(responseSchema),
        },
      },
    },
    400: {
      description: "Validation Error for ID",
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
  app.get(
    "/:id",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("creator"),
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    async (c) => {
      const id = c.req.param("id");
      const result = await handleRequest(Number(id));
      return c.json(result);
    }
  );
}
