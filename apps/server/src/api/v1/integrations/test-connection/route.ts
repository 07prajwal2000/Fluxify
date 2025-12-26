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
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Test integration connection",
  operationId: "test-connection",
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
  },
};

export default function (app: HonoServer) {
  app.post(
    "/test-connection",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("creator"),
    validator("json", requestBodySchema, zodErrorCallbackParser),
    async (c) => {
      const body = c.req.valid("json");
      const result = await handleRequest(body);
      return c.json(result, result.success ? 200 : 400);
    }
  );
}
