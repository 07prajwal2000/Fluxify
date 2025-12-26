import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Get list of app config keys",
  operationId: "get-keys-list",
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
  },
};

export default function (app: HonoServer) {
  app.get(
    "/keys",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("creator"),
    validator("query", requestQuerySchema, zodErrorCallbackParser),
    async (c) => {
      const { search } = c.req.valid("query");
      const keys = await handleRequest(search);
      return c.json(keys);
    }
  );
}
