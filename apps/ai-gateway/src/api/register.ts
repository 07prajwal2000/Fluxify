import type { Hono } from "hono";
import { registerHarnessConversationRoutes } from "./v1/harness-conversations/register";
import findResource from "./v1/find-resource/route";

export function registerRoutes(app: Hono) {
	const subRoute = app.basePath("/_/admin/api/ai/v1");
	registerHarnessConversationRoutes(subRoute);
	findResource(subRoute);
}
