import type { HonoServer } from "../../../types";
import { registerDeploymentRoutes } from "../deployments/register";
import { registerVersionRoutes } from "../versions/register";
import registerCallRoute from "./call/route";
import registerCreateRoute from "./create/route";
import registerDeleteRoute from "./delete/route";
import registerExportRoute from "./export/route";
import registerGetAllRoute from "./get-all/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerGetCanvasItems from "./get-canvas-items/route";
import registerGetCanvasRevision from "./get-canvas-revision/route";
import registerImportRoute from "./import/route";
import registerImportCheckRoute from "./import-check/route";
import registerOpenapiRoute from "./openapi/route";
import registerResponseSchemas from "./response-schemas/route";
import registerSaveCanvasState from "./save-canvas-state/route";
import registerUpdateRoute from "./update/route";
import registerUpdatePartialRoute from "./update-partial/route";

export default {
	name: "routes",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/routes");
		registerGetAllRoute(router);
		registerGetByIdRoute(router);
		registerExportRoute(router);
		registerCreateRoute(router);
		registerImportRoute(router);
		registerImportCheckRoute(router);
		registerUpdateRoute(router);
		registerDeleteRoute(router);
		registerUpdatePartialRoute(router);
		registerGetCanvasItems(router);
		registerGetCanvasRevision(router);
		registerSaveCanvasState(router);
		registerOpenapiRoute(router);
		registerResponseSchemas(router);
		registerCallRoute(router);
		registerVersionRoutes(router, "route");
		registerDeploymentRoutes(router, "route");
	},
};
