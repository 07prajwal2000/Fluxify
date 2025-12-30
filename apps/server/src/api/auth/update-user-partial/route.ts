import { zValidator } from "@hono/zod-validator";
import { User } from "better-auth";
import { HonoServer } from "../../../types";
import { requireSystemAdmin } from "../middleware";
import { requestBodySchema, requestParamsSchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
  app.patch(
    "/update-user/:userId",
    requireSystemAdmin,
    zValidator("param", requestParamsSchema),
    zValidator("json", requestBodySchema),
    async (c) => {
      const params = c.req.valid("param");
      const body = c.req.valid("json");
      const user = c.get("user") as User;

      const result = await handleRequest(user, params, body);

      const response = responseSchema.parse(result);

      return c.json(response);
    }
  );
}
