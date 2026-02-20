import appCreate from "./create/route";
import appUpdate from "./update/route";
import appDelete from "./delete/route";
import appGetById from "./get-by-id/route";
import appGetAll from "./get-all/route";
import appRun from "./run/route";
import appRunAll from "./run-all/route";

import { HonoServer } from "../../../types";

export default {
  registerHandler(app: HonoServer) {
    const router = app.basePath("/test-suites");
    appCreate(router);
    appUpdate(router);
    appDelete(router);
    appGetById(router);
    appGetAll(router);
    appRun(router);
    appRunAll(router);
  },
};
