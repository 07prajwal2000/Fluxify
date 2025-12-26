import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "create a new project",
  operationId: "create-project",
  tags: ["Projects"],
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
      description: "Invalid json data",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
    409: {
      description: "Name conflict. Project name should be unique",
      content: {
        "application/json": {
          schema: resolver(errorSchema),
        },
      },
    },
  },
};

export default function (app: HonoServer) {
  app.post(
    "/",
    describeRoute(openapiRouteOptions),
    requireSystemAdmin,
    validator("json", requestBodySchema, zodErrorCallbackParser),
    async (c) => {
      const data = c.req.valid("json");
      const result = await handleRequest(data);
      return c.json(result);
    }
  );
}
