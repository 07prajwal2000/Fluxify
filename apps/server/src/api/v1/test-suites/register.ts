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
		const routeRouter = app.basePath("/test-suites/route/:routeId");

		// Route-specific test suite operations
		appCreate(routeRouter);
		appGetAll(routeRouter);
		appRunAll(routeRouter);

		// Test suite specific operations
		appUpdate(router);
		appDelete(router);
		appGetById(router);
		appRun(router);
	},
};
