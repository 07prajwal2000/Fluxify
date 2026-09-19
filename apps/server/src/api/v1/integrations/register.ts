import { Hono } from "hono";
import type { HonoServer } from "../../../types";
import registerCreateRoute from "./create/route";
import registerDeleteRoute from "./delete/route";
import registerGetAllRoute from "./get-all/route";
import registerGetBasicListRoute from "./get-basic-list/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerGetMetadataRoute from "./get-metadata/route";
import registerTestConnectionRoute from "./test-connection/route";
import registerTestExistingConnectionRoute from "./test-existing-connection/route";
import registerUpdateRoute from "./update/route";

export default {
	name: "integrations",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/:projectId/integrations");
		registerGetBasicListRoute(router);
		registerGetAllRoute(router);
		registerGetByIdRoute(router);
		registerGetMetadataRoute(router);
		registerCreateRoute(router);
		registerUpdateRoute(router);
		registerDeleteRoute(router);
		registerTestConnectionRoute(router);
		registerTestExistingConnectionRoute(router);
	},
};
