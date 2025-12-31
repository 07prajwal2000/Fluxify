import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestParamSchema, responseSchema } from "./dto";
import { HonoServer } from "../../../../../../types";
import zodErrorCallbackParser from "../../../../../../middlewares/zodErrorCallbackParser";
import { validationErrorSchema } from "../../../../../../errors/validationError";
import { errorSchema } from "../../../../../../errors/customError";
import { requireProjectAccess } from "../../../../../auth/middleware";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
  operationId: "project-members-remove",
  description: "Remove a user from project's ACL",
  tags: ["Projects", "Project Settings", "Members"],
  responses: {
    204: {
      description: "Deleted",
      content: { "application/json": { schema: resolver(responseSchema) } },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": { schema: resolver(validationErrorSchema) },
      },
    },
    404: {
      description: "ACL not found",
      content: { "application/json": { schema: resolver(errorSchema) } },
    },
  },
};

export default function (app: HonoServer) {
  app.delete(
    "/remove/:userId",
    describeRoute(openapiRouteOptions),
    requireProjectAccess("project_admin", { key: "id", source: "param" }),
    validator("param", requestParamSchema, zodErrorCallbackParser),
    async (c) => {
      const { id } = c.req.param();
      const params = c.req.valid("param");
      await handleRequest(id, params);
      return c.body(null, 204);
    }
  );
}
