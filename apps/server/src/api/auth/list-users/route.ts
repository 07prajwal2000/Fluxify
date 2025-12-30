import { Hono } from "hono";
import { validator } from "hono-openapi";
import handleRequest from "./service";
import { requestBodySchema } from "./dto";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { requireRoleAccess, requireSystemAdmin } from "../middleware";
import { HonoServer } from "../../../types";

export default function (app: HonoServer) {
  app.get(
    "/list-users",
    validator("query", requestBodySchema, zodErrorCallbackParser),
    requireRoleAccess("viewer"),
    async (ctx) => {
      const query = ctx.req.valid("query");
      const result = await handleRequest(query);
      return ctx.json(result);
    }
  );
}
