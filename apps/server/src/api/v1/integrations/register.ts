import { Hono } from "hono";
import registerGetAllRoute from "./get-all/route";
import registerGetByIdRoute from "./get-by-id/route";
import registerGetMetadataRoute from "./get-metadata/route";
import registerCreateRoute from "./create/route";
import registerUpdateRoute from "./update/route";
import registerDeleteRoute from "./delete/route";
import registerTestConnectionRoute from "./test-connection/route";
import registerTestExistingConnectionRoute from "./test-existing-connection/route";
import registerGetBasicListRoute from "./get-basic-list/route";
import { HonoServer } from "../../../types";

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
