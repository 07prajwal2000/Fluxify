import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { requestRouteSchema } from "../../routes/get-by-id/dto";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { errorSchema } from "../../../../errors/customError";
import { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Update the project",
  operationId: "update-project",
  tags: ["Projects"],
  responses: {
    200: {
      description: "Update successful",
      content: {
        "application/json": {
          schema: resolver(responseSchema),
        },
      },
    },
    404: {
      description: "No project found with id",
      content: {
        "application/json": {
          schema: resolver(errorSchema),
        },
      },
    },
    409: {
      description: "Name conflict, if project with same name exists",
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
    requireProjectAccess("project_admin", { key: "id", source: "param" }),
    validator("param", requestRouteSchema, zodErrorCallbackParser),
    validator("json", requestBodySchema, zodErrorCallbackParser),
    async (c) => {
      const body = c.req.valid("json");
      const { id } = c.req.valid("param");
      const result = await handleRequest(id, body);
      return c.json(result);
    }
  );
}
