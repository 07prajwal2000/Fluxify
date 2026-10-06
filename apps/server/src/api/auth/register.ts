import { Hono } from "hono";
import { auth } from "../../lib/auth";
import type { HonoServer } from "../../types";
import mapChangeUserPasswordRoute from "./change-user-password/route";
import mapCreateAuthUserRoute from "./create-user/route";
import mapDeleteUserRoute from "./delete-user/route";
import mapListUsersRoute from "./list-users/route";
import { mapOAuthRoutes } from "./oauthRoutes";
import mapUpdateUserPartialRoute from "./update-user-partial/route";

export default {
	name: "authentication",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/_/admin/api/auth");
		mapCreateAuthUserRoute(router);
		mapListUsersRoute(router);
		mapUpdateUserPartialRoute(router);
		mapDeleteUserRoute(router);
		mapChangeUserPasswordRoute(router);
		mapOAuthRoutes(app);
		app.on(["POST", "GET"], "/_/admin/api/auth/*", (c) => {
			return auth.handler(c.req.raw);
		});
	},
};
