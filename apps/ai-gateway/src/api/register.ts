import type { Hono } from "hono";
import { registerWorkflowRoutes } from "./v1/workflows/register";
import { registerConversationRoutes } from "./v1/conversations/register";
import { registerHarnessConversationRoutes } from "./v1/harness-conversations/register";

export function registerRoutes(app: Hono) {
	const subRoute = app.basePath("/_/admin/api/ai/v1");
	registerWorkflowRoutes(subRoute);
	registerConversationRoutes(subRoute);
	registerHarnessConversationRoutes(subRoute);
}
