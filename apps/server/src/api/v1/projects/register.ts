import { HonoServer } from "../../../types";
import registerProjectMembers from "./settings/members/register";
import createProjectRoute from "./create/route";
import getAllProjectRoute from "./get-all/route";
import updateProjectRoute from "./update/route";
import registerProjectSettingsKeys from "./settings/keys/register";
import registerProjectNodes from "../orchestration/projectRoutes";

export default {
  name: "routes",
  registerHandler(app: HonoServer) {
    const router = app.basePath("/projects");
    createProjectRoute(router);
    getAllProjectRoute(router);
    updateProjectRoute(router);
    registerProjectMembers(router);
    registerProjectSettingsKeys(router);
    registerProjectNodes(router);
  },
};
