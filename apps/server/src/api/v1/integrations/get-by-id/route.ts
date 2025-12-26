import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { errorSchema } from "../../../../errors/customError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Get integration by id",
  operationId: "get-integration-by-id",
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
      description: "Integration not found",
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
      const result = await handleRequest(id);
      return c.json(result);
    }
  );
}
