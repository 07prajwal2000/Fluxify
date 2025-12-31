import { zValidator } from "@hono/zod-validator";
import { User } from "better-auth";
import { HonoServer } from "../../../types";
import { requireSystemAdmin } from "../middleware";
import { requestParamsSchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
  app.delete(
    "/delete-user/:userId",
    requireSystemAdmin,
    zValidator("param", requestParamsSchema),
    async (c) => {
      const params = c.req.valid("param");
      const user = c.get("user") as User;
      const result = await handleRequest(user, params);

      const response = responseSchema.parse(result);

      return c.json(response);
    }
  );
}
