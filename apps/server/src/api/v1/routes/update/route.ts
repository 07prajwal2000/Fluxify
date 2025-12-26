import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestBodySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Updates the existing route and returns the object",
  operationId: "update-route",
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
      description: "Validation error for json body or route `id`param",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
    404: {
      description: "Not found error",
      content: {
        "application/json": {
          schema: resolver(errorSchema),
        },
      },
    },
    409: {
      description: "If any conflict with the path & method or name",
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
    "/:id",
    describeRoute(openapiRouteOptions),
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    validator("json", requestBodySchema, zodErrorCallbackParser),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const acl = c.get("acl") || [];
      const result = await handleRequest(id, data, acl);
      return c.json(result);
    }
  );
}
