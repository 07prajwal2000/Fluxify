import type { HonoServer } from "../../../types";
import registerCreateRoute from "./create/route";
import registerDeleteRoute from "./delete/route";
import registerGetAllRoute from "./get-all/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerGetCanvasItems from "./get-canvas-items/route";
import registerOpenapiRoute from "./openapi/route";
import registerSaveCanvasState from "./save-canvas-state/route";
import registerUpdateRoute from "./update/route";
import registerUpdatePartialRoute from "./update-partial/route";

export default {
	name: "routes",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/routes");
		registerGetAllRoute(router);
		registerGetByIdRoute(router);
		registerCreateRoute(router);
		registerUpdateRoute(router);
		registerDeleteRoute(router);
		registerUpdatePartialRoute(router);
		registerGetCanvasItems(router);
		registerSaveCanvasState(router);
		registerOpenapiRoute(router);
	},
};
