import type { Hono } from "hono";
import { registerAgentRoutes } from "./v1/agent/register";
import findResource from "./v1/find-resource/route";
import { registerHarnessConversationRoutes } from "./v1/harness-conversations/register";

export function registerRoutes(app: Hono) {
	const subRoute = app.basePath("/_/admin/api/ai/v1");
	registerHarnessConversationRoutes(subRoute);
	registerAgentRoutes(subRoute);
	findResource(subRoute);
}
