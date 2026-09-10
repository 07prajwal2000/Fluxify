import registerGetAllRoute from "./get-all/route";
import registerGetByCategoryRoute from "./get-by-category/route";
import registerGetByKeyRoute from "./get-by-key/route";
import registerUpsertRoute from "./upsert/route";
import registerGetAuthSettingsRoute from "./get-auth-settings/route";
import registerPatchAuthSettingsRoute from "./patch-auth-settings/route";
import registerLicenseRoutes from "./license/route";
import { HonoServer } from "../../../types";

export default {
	name: "instance-settings",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/instance-settings");
		registerLicenseRoutes(router); // before get-by-key, so "/license" is not read as a key
		registerGetAllRoute(router);
		registerGetByCategoryRoute(router);
		registerGetByKeyRoute(router);
		registerUpsertRoute(router);
		registerGetAuthSettingsRoute(router);
		registerPatchAuthSettingsRoute(router);
	},
};
