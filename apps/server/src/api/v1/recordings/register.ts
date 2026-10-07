import type { HonoServer } from "../../../types";
import appDeleteRun from "./delete-run/route";
import appDeleteRuns from "./delete-runs/route";
import appGetRunById from "./get-run-by-id/route";
import appGetRuns from "./get-runs/route";

export default {
	registerHandler(app: HonoServer) {
		// Same path shape as test runs: the project is in the path, so authorization
		// costs no database read, and every query is scoped by project AND target.
		const runsRouter = app.basePath("/:projectId/recordings/:kind{route|workflow}/:targetId/runs");

		appGetRuns(runsRouter);
		appGetRunById(runsRouter);
		appDeleteRuns(runsRouter);
		appDeleteRun(runsRouter);
	},
};
