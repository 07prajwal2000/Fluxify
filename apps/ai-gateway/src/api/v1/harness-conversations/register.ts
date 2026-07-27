import type { Hono } from "hono";
import listConversations from "./list/route";
import updateConversation from "./update/route";
import deleteConversation from "./delete/route";
import sendMessage from "./send-message/route";
import conversationAction from "./action/route";
import listMessages from "./list-messages/route";

export function registerHarnessConversationRoutes(app: Hono) {
	const subRoute = app.basePath("/:projectId/harness-conversations");
	listConversations(subRoute);
	updateConversation(subRoute);
	deleteConversation(subRoute);
	sendMessage(subRoute);
	conversationAction(subRoute);
	listMessages(subRoute);
}
