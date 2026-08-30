import { HonoServer } from "../../../types";
import registerGetAllRoute from "./get-all/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerGetCanvasItemsRoute from "./get-canvas-items/route";
import registerSaveCanvasRoute from "./save-canvas/route";
import registerCreateRoute from "./create/route";
import registerUpdateRoute from "./update/route";
import registerDeleteRoute from "./delete/route";
import registerRunRoute from "./run/route";

export default {
	name: "workflows",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/workflows");
		// `/list` is registered before `/:id`, or the literal is swallowed by the param
		registerGetAllRoute(router);
		registerGetByIdRoute(router);
		registerGetCanvasItemsRoute(router);
		registerSaveCanvasRoute(router);
		registerCreateRoute(router);
		registerUpdateRoute(router);
		registerDeleteRoute(router);
		registerRunRoute(router);
	},
};
