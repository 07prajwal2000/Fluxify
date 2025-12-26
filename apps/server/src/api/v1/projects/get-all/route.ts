import { Hono } from "hono";
import {
  describeRoute,
  DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { AuthACL } from "../../../../db/schema";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Get all projects with pagination",
  operationId: "get-all-projects",
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
      description: "Invalid Pagination details",
      content: {
        "application/json": {
          schema: resolver(validationErrorSchema),
        },
      },
    },
  },
};

export default function (app: HonoServer) {
  app.get(
    "/list",
    describeRoute(openapiRouteOptions),
    validator("query", requestQuerySchema, zodErrorCallbackParser),
    async (c) => {
      const query = c.req.valid("query");
      const acl = c.get("acl")! as AuthACL[];
      const projectsList = acl.map((a) => a.projectId);
      console.log(projectsList);
      const data = await handleRequest(query, projectsList);
      return c.json(data);
    }
  );
}
