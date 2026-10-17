import type { HonoServer } from "../../../../types";
import registerFiltersRoute from "./filters/route";
import registerListRoute from "./list/route";

/** Reads of the audit log (#834). Mounted at `/instance-settings/audit-logs`. */
export default function registerAuditLogRoutes(app: HonoServer) {
	const router = app.basePath("/audit-logs");
	registerListRoute(router);
	registerFiltersRoute(router);
}
