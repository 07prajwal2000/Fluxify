import type { HonoServer } from "../../../types";
import { registerDeploymentRoutes } from "../deployments/register";
import { registerVersionRoutes } from "../versions/register";
import registerCreateRoute from "./create/route";
import registerDeleteRoute from "./delete/route";
import registerGetAllRoute from "./get-all/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerGetCanvasItemsRoute from "./get-canvas-items/route";
import registerGetCanvasRevisionRoute from "./get-canvas-revision/route";
import registerReferencesRoute from "./references/route";
import registerSaveCanvasRoute from "./save-canvas/route";
import registerUpdateRoute from "./update/route";

export default {
	name: "custom-blocks",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/custom-blocks");
		registerGetAllRoute(router);
		registerGetByIdRoute(router);
		registerGetCanvasItemsRoute(router);
		registerGetCanvasRevisionRoute(router);
		registerSaveCanvasRoute(router);
		registerCreateRoute(router);
		registerUpdateRoute(router);
		registerDeleteRoute(router);
		registerReferencesRoute(router);
		registerVersionRoutes(router, "custom_block");
		registerDeploymentRoutes(router, "custom_block");
	},
};
