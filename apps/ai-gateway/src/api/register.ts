import type { Hono } from "hono";
import { registerHarnessConversationRoutes } from "./v1/harness-conversations/register";

export function registerRoutes(app: Hono) {
	const subRoute = app.basePath("/_/admin/api/ai/v1");
	registerHarnessConversationRoutes(subRoute);
}
