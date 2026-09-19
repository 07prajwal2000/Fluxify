import type { Hono } from "hono";
import conversationAction from "./action/route";
import artifacts from "./artifacts/route";
import deleteConversation from "./delete/route";
import listConversations from "./list/route";
import listMessages from "./list-messages/route";
import sendMessage from "./send-message/route";
import updateConversation from "./update/route";

export function registerHarnessConversationRoutes(app: Hono) {
	const subRoute = app.basePath("/:projectId/harness-conversations");
	listConversations(subRoute);
	updateConversation(subRoute);
	deleteConversation(subRoute);
	sendMessage(subRoute);
	conversationAction(subRoute);
	listMessages(subRoute);
	artifacts(subRoute);
}
