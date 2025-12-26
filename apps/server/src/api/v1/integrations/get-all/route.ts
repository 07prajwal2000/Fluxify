import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Get all integrations by group",
  operationId: "get-all-integrations-by-group",
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
    400: {
      description: "Query validation error",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
  },
};

export default function (app: HonoServer) {
  app.get(
    "/list/:group",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("creator"),
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    async (c) => {
      const { group } = c.req.valid("param");
      const result = await handleRequest(group);
      return c.json(result);
    }
  );
}
