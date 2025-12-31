import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestQuerySchema, responseSchema } from "./dto";
import zodErrorCallbackParser from "../../../../../../middlewares/zodErrorCallbackParser";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import { errorSchema } from "../../../../../../errors/customError";
import { HonoServer } from "../../../../../../types";
import handleRequest from "./service";
import { requireProjectAccess } from "../../../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
  operationId: "project-members-list",
  description:
    "List users associated with a project with optional filters and pagination",
  tags: ["Projects", "Project Settings", "Members"],
  responses: {
    200: {
      description: "Successful",
      content: { "application/json": { schema: resolver(responseSchema) } },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": { schema: resolver(validationErrorSchema) },
      },
    },
  },
};

export default function (app: HonoServer) {
  app.get(
    "/list",
    describeRoute(openapiRouteOptions),
    requireProjectAccess("creator", { key: "id", source: "param" }),
    validator("query", requestQuerySchema, zodErrorCallbackParser),
    async (c) => {
      const { id } = c.req.param();
      const query = c.req.valid("query");
      const result = await handleRequest(id, query);
      return c.json(result);
    }
  );
}
