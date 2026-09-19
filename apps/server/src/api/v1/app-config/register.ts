import { Hono } from "hono";
import type { HonoServer } from "../../../types";
import registerCreateRoute from "./create/route";
import registerDeleteRoute from "./delete/route";
import registerDeleteBulkRoute from "./delete-bulk/route";
import registerGetAllRoute from "./get-all/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerGetKeysListRoute from "./get-keys-list/route";
import registerUpdateRoute from "./update/route";

export default {
	name: "app-config",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/:projectId/app-config");
		registerGetAllRoute(router);
		registerGetKeysListRoute(router);
		registerCreateRoute(router);
		registerUpdateRoute(router);
		registerDeleteRoute(router);
		registerDeleteBulkRoute(router);
		registerGetByIdRoute(router);
	},
};
