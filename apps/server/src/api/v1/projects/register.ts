import type { HonoServer } from "../../../types";
import registerProjectNodes from "../orchestration/projectRoutes";
import createProjectRoute from "./create/route";
import getAllProjectRoute from "./get-all/route";
import registerProjectSettingsKeys from "./settings/keys/register";
import registerProjectMembers from "./settings/members/register";
import registerProjectPackages from "./settings/packages/register";
import systemLogsRoute from "./system-logs/route";
import updateProjectRoute from "./update/route";

export default {
	name: "routes",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/projects");
		createProjectRoute(router);
		getAllProjectRoute(router);
		updateProjectRoute(router);
		registerProjectMembers(router);
		registerProjectSettingsKeys(router);
		registerProjectPackages(router);
		registerProjectNodes(router);
		systemLogsRoute(router);
	},
};
