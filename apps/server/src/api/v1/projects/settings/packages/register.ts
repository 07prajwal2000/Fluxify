import type { HonoServer } from "../../../../../types";
import registerInstall from "./install/route";
import registerList from "./list/route";
import registerRemove from "./remove/route";
import registerStatus from "./status/route";
import registerUpdates from "./updates/route";

/** npm packages (#477) */
export default function registerProjectPackages(app: HonoServer) {
	const router = app.basePath("/:id/settings/packages");
	registerList(router);
	registerInstall(router);
	registerRemove(router);
	registerUpdates(router);
	registerStatus(router);
}
