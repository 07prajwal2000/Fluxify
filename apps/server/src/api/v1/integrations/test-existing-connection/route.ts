import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { responseSchema } from "./dto";
import handleRequest from "./service";
import { requestRouteSchema } from "../../routes/get-by-id/dto";
import { errorSchema } from "../../../../errors/customError";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Test the existing integration by its ID",
  operationId: "test-existing-integration",
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
    "/test-existing-connection/:id",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("creator"),
    validator("param", requestRouteSchema),
    async (c) => {
      const params = c.req.valid("param");
      const result = await handleRequest(params);
      return c.json(result);
    }
  );
}
