import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import handleRequest from "./service";
import { requestRouteSchema } from "./dto";
import { errorSchema } from "../../../../errors/customError";
import { HonoServer } from "../../../../types";
import { requireRoleAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Delete an integration",
  operationId: "delete-integration",
  tags: ["Integrations"],
  responses: {
    204: {
      description: "No Content",
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
  app.delete(
    "/:id",
    describeRoute(openapiRouteOptions),
    requireRoleAccess("project_admin"),
    validator("param", requestRouteSchema),
    async (c) => {
      const id = c.req.param("id");
      await handleRequest(id);
      return c.body(null, 204);
    }
  );
}
