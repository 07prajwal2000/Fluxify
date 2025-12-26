import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestBodySchema, requestRouteSchema } from "./dto";
import { validationErrorSchema } from "../../../../errors/validationError";
import { errorSchema } from "../../../../errors/customError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestBodyValidator } from "./middleware";
import handleRequest from "./service";
import { HonoServer } from "../../../../types";

const openapiRouteOptions: DescribeRouteOptions = {
  description:
    "Upsert action and saves the state by taking changes and actions to perform operation",
  operationId: "save-canvas-state",
  tags: ["Routes"],
  responses: {
    204: {
      description: "No content returned after successful operation",
    },
    400: {
      description: "Invalid ID/Data format",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
    404: {
      description: "Route not found",
      content: {
        "application/json": {
          schema: resolver(errorSchema),
        },
      },
    },
    409: {
      description: "Any conflict between IDs/data",
      content: {
        "application/json": {
          schema: resolver(errorSchema),
        },
      },
    },
  },
};

export default function (app: HonoServer) {
  app.put(
    "/:id/save-canvas",
    describeRoute(openapiRouteOptions),
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    validator("json", requestBodySchema, zodErrorCallbackParser),
    requestBodyValidator,
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const acl = c.get("acl") || [];
      await handleRequest(id, data, acl);
      return c.body(null, 204);
    }
  );
}
