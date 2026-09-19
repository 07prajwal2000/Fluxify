import type { HonoServer } from "../../../../../types";
import registerAdd from "./add/route";
import registerList from "./list/route";
import registerRemove from "./remove/route";
import registerUpdate from "./update/route";

export default function registerProjectMembers(app: HonoServer) {
	const router = app.basePath("/:id/settings/members");
	registerList(router);
	registerAdd(router);
	registerUpdate(router);
	registerRemove(router);
}
