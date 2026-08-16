import appCreate from "./create/route";
import appUpdate from "./update/route";
import appDelete from "./delete/route";
import appGetById from "./get-by-id/route";
import appGetAll from "./get-all/route";
import appStartRun from "./start-run/route";
import appGetRuns from "./get-runs/route";
import appGetRunById from "./get-run-by-id/route";
import appDeleteRuns from "./delete-runs/route";

import { HonoServer } from "../../../types";

export default {
	registerHandler(app: HonoServer) {
		const router = app.basePath("/test-suites");
		const routeRouter = app.basePath("/test-suites/route/:routeId");
		// Runs carry the project in the path so authorization costs no database
		// read — see start-run/dto.ts.
		const runsRouter = app.basePath(
			"/:projectId/test-suites/route/:routeId/runs",
		);

		// Route-specific test suite operations
		appCreate(routeRouter);
		appGetAll(routeRouter);

		// Test suite specific operations
		appUpdate(router);
		appDelete(router);
		appGetById(router);

		// Test runs
		appStartRun(runsRouter);
		appGetRuns(runsRouter);
		appGetRunById(runsRouter);
		appDeleteRuns(runsRouter);
	},
};
