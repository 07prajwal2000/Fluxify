import type { Hono } from "hono";
import listConversations from "./list/route";
import createConversation from "./create/route";
import listMessages from "./list_messages/route";
import clearConversation from "./clear/route";
import updateConversation from "./update/route";
import deleteConversation from "./delete/route";
import recordAction from "./record_action/route";

export function registerConversationRoutes(app: Hono) {
	const subRoute = app.basePath("/conversations");
	listConversations(subRoute);
	createConversation(subRoute);
	listMessages(subRoute);
	clearConversation(subRoute);
	updateConversation(subRoute);
	deleteConversation(subRoute);
	recordAction(subRoute);
}
