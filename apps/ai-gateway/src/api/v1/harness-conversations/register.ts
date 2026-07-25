import type { Hono } from "hono";
import listConversations from "./list/route";
import updateConversation from "./update/route";
import deleteConversation from "./delete/route";
import sendMessage from "./send-message/route";

export function registerHarnessConversationRoutes(app: Hono) {
	const subRoute = app.basePath("/harness-conversations");
	listConversations(subRoute);
	updateConversation(subRoute);
	deleteConversation(subRoute);
	sendMessage(subRoute);
}
