import type { HonoServer } from "../../../types";
import appCreate from "./create/route";
import appDelete from "./delete/route";
import appDeleteRuns from "./delete-runs/route";
import appGetAll from "./get-all/route";
import appGetById from "./get-by-id/route";
import appGetRunById from "./get-run-by-id/route";
import appGetRuns from "./get-runs/route";
import appStartRun from "./start-run/route";
import appUpdate from "./update/route";

const TARGET = ":kind{route|workflow}/:targetId";

export default {
	registerHandler(app: HonoServer) {
		const router = app.basePath("/test-suites");
		// a suite tests a route or a workflow (#487); `/route/...` paths are unchanged
		const targetRouter = app.basePath(`/test-suites/${TARGET}`);
		// Runs carry the project in the path so authorization costs no database
		// read — see start-run/dto.ts.
		const runsRouter = app.basePath(`/:projectId/test-suites/${TARGET}/runs`);

		// Target-specific test suite operations
		appCreate(targetRouter);
		appGetAll(targetRouter);

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
