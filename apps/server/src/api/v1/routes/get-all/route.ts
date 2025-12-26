import handleRequest from "./service";
import { requestQuerySchema, responseSchema } from "./dto";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { validationErrorSchema } from "../../../../errors/validationError";
import { errorSchema } from "../../../../errors/customError";
import { HonoServer } from "../../../../types";

const openApiOptions: DescribeRouteOptions = {
  operationId: "get-routes-list",
  description:
    "Returns a list of Routes sorted by createdAt with pagination details",
  tags: ["Routes"],
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
      description: "Pagination Query Params Validation Error",
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
  },
};

export default function (app: HonoServer) {
  app.get(
    "/list",
    describeRoute(openApiOptions),
    validator("query", requestQuerySchema, zodErrorCallbackParser),
    async (ctx) => {
      const query = ctx.req.valid("query");
      const acl = ctx.get("acl") || [];
      const result = await handleRequest(query, acl);
      return ctx.json(result);
    }
  );
}
