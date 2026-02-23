import { HonoServer } from "../../../../../types";
import registerGetAllKeys from "./get-all/route";
import registerUpsertKey from "./upsert/route";

export default function registerProjectSettingsKeys(app: HonoServer) {
  const router = app.basePath("/:id/settings/keys");
  registerGetAllKeys(router);
  registerUpsertKey(router);
}
