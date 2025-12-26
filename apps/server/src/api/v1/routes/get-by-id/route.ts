import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestRouteSchema, responseSchema } from "./dto";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { validationErrorSchema } from "../../../../errors/validationError";
import { errorSchema } from "../../../../errors/customError";
import handleRequest from "./service";
import { HonoServer } from "../../../../types";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Returns a Route if matching id exist",
  operationId: "get-route-by-id",
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
      description: "Invalid id (uuidv7)",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
    404: {
      description: "No record found",
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
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    async (ctx) => {
      const { id } = ctx.req.valid("param");
      const acl = ctx.get("acl") || [];
      const result = await handleRequest(id, acl);
      return ctx.json(result);
    }
  );
}
