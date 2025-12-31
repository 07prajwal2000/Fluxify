import { HonoServer } from "../../../../../types";
import registerList from "./list/route";
import registerAdd from "./add/route";
import registerUpdate from "./update/route";
import registerRemove from "./remove/route";

export default function registerProjectMembers(app: HonoServer) {
  const router = app.basePath("/:id/settings/members");
  registerList(router);
  registerAdd(router);
  registerUpdate(router);
  registerRemove(router);
}
