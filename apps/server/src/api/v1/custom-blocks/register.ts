import type { HonoServer } from "../../../types";
import registerCreateRoute from "./create/route";
import registerDeleteRoute from "./delete/route";
import registerGetAllRoute from "./get-all/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerGetCanvasItemsRoute from "./get-canvas-items/route";
import registerSaveCanvasRoute from "./save-canvas/route";
import registerUpdateRoute from "./update/route";

export default {
	name: "custom-blocks",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/custom-blocks");
		registerGetAllRoute(router);
		registerGetByIdRoute(router);
		registerGetCanvasItemsRoute(router);
		registerSaveCanvasRoute(router);
		registerCreateRoute(router);
		registerUpdateRoute(router);
		registerDeleteRoute(router);
	},
};
