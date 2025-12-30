import { Hono } from "hono";
import { auth } from "../../lib/auth";
import mapCreateAuthUserRoute from "./create-user/route";
import mapListUsersRoute from "./list-users/route";
import mapUpdateUserPartialRoute from "./update-user-partial/route";
import mapDeleteUserRoute from "./delete-user/route";
import { HonoServer } from "../../types";

export default {
  name: "authentication",
  registerHandler(app: HonoServer) {
    const router = app.basePath("/_/admin/api/auth");
    mapCreateAuthUserRoute(router);
    mapListUsersRoute(router);
    mapUpdateUserPartialRoute(router);
    mapDeleteUserRoute(router);
    app.on(["GET", "POST"], "/_/admin/api/auth/*", (c) =>
      auth.handler(c.req.raw)
    );
  },
};
