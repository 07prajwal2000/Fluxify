import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { AuthACL } from "../../../../db/schema";

const openapiRouteOptions: DescribeRouteOptions = {
  description:
    "Deletes the route and its descendants by id and returns nothing",
  operationId: "delete-route",
  tags: ["Routes"],
  responses: {
    204: {
      description: "Successfully deleted",
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
  app.delete(
    "/:id",
    describeRoute(openapiRouteOptions),
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    async (c) => {
      const { id } = c.req.valid("param");
      const acl = c.get("acl") as AuthACL[];
      await handleRequest(id, acl);
      return c.body(null, 204);
    }
  );
}
