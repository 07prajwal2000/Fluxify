import registerGetAllRoute from "./get-all/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerCreateRoute from "./create/route";
import registerUpdateRoute from "./update/route";
import registerDeleteRoute from "./delete/route";
import registerUpdatePartialRoute from "./update-partial/route";
import registerGetCanvasItems from "./get-canvas-items/route";
import registerSaveCanvasState from "./save-canvas-state/route";
import registerOpenapiRoute from "./openapi/route";
import { HonoServer } from "../../../types";

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
