import {
	type AccessControlRole,
	type AuthACL,
	ForbiddenError,
	hasProjectAccess,
	NotFoundError,
	type User,
	zodErrorCallbackParser,
} from "@fluxify/server";
import { zValidator } from "@hono/zod-validator";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { EFFORTS } from "../../../agent/model";
import { projectSupportsThinking } from "../../../agent/runner/integration";
import { freshConversation, releaseIfOrphaned } from "../../../agent/runner/orphans";
import {
	type AgentMeta,
	createConversation,
	getConversation,
	getRun,
	listConversations,
} from "../../../agent/runner/repository";
import { MODES } from "../../../agent/tools";
import {
	answerApproval,
	compactConversation,
	getConversationDetail,
	getOlderMessages,
	patchConversation,
	removeConversation,
	sendMessage,
	stopRun,
} from "./service";
import { streamRun } from "./stream";

type Caller = User & { isSystemAdmin: boolean };

/** The caller, once they hold `role` in `projectId`. */
function caller(c: Context, projectId: string, role: AccessControlRole) {
	const user = c.get("user") as Caller | null;
	if (!user || !hasProjectAccess(user, c.get("acl") as AuthACL[], projectId, role))
		throw new ForbiddenError("You do not have access to this project");
	return user;
}

/** A new-agent conversation of this project the caller owns (system admins see all). */
async function owned(user: Caller, conversationId: string, projectId?: string) {
	const conversation = await getConversation(conversationId);
	const meta = conversation?.metadata as AgentMeta | null | undefined;
	// One 404 for missing, other project and pre-agent conversations: nothing leaks.
	if (!conversation || !meta?.agent || (projectId && conversation.projectId !== projectId))
		throw new NotFoundError("Conversation not found");
	if (conversation.userId !== user.id && !user.isSystemAdmin)
		throw new ForbiddenError("You do not own this conversation");
	return conversation;
}

const json = <T extends z.ZodType>(schema: T) => zValidator("json", schema, zodErrorCallbackParser);
const mode = z.enum(MODES as [string, ...string[]]);
const effort = z.enum(EFFORTS);

/** In-conversation routes: project role first, then ownership. A run whose worker died is released first (#696). */
async function conversationOf(c: Context, role: AccessControlRole) {
	const projectId = c.req.param("projectId") as string;
	const user = caller(c, projectId, role);
	return {
		user,
		conversation: await freshConversation(
			await owned(user, c.req.param("conversationId") as string, projectId),
		),
	};
}

/**
 * The new agent's HTTP API (#646), under `/v1/agent`. Conversations live in the
 * `agent_*` rows; messages are the #645 rows. Runs happen on the gateway worker;
 * `/runs/:runId/stream` follows one live.
 */
export function registerAgentRoutes(app: Hono) {
	const r = app.basePath("/agent");
	const base = "/:projectId/conversations";

	r.post(base, json(z.object({ title: z.string().min(1).max(255).optional() })), async (c) => {
		const projectId = c.req.param("projectId");
		const user = caller(c, projectId, "creator");
		return c.json(await createConversation(user.id, projectId, c.req.valid("json").title), 201);
	});

	// For the new-chat page, before a conversation exists: does the project's model take a thinking setting?
	r.get("/:projectId/model", async (c) => {
		const projectId = c.req.param("projectId");
		caller(c, projectId, "viewer");
		return c.json({ supportsThinking: await projectSupportsThinking(projectId) });
	});

	r.get(base, async (c) => {
		const projectId = c.req.param("projectId");
		const user = caller(c, projectId, "viewer");
		return c.json(await listConversations(user.id, projectId));
	});

	// Latest page with the run and settings; with `beforeSeq`, just the page of messages before it.
	r.get(
		`${base}/:conversationId`,
		zValidator(
			"query",
			z.object({ beforeSeq: z.coerce.number().int().min(0).optional() }),
			zodErrorCallbackParser,
		),
		async (c) => {
			const { conversation } = await conversationOf(c, "viewer");
			const { beforeSeq } = c.req.valid("query");
			return c.json(
				beforeSeq === undefined
					? await getConversationDetail(conversation)
					: await getOlderMessages(conversation, beforeSeq),
			);
		},
	);

	r.patch(
		`${base}/:conversationId`,
		json(
			z
				.object({
					title: z.string().min(1).max(255),
					pinned: z.boolean(),
					archived: z.boolean(),
				})
				.partial()
				.refine((b) => Object.keys(b).length > 0, "Nothing to update"),
		),
		async (c) => {
			const { conversation } = await conversationOf(c, "creator");
			return c.json(await patchConversation(conversation, c.req.valid("json")));
		},
	);

	r.delete(`${base}/:conversationId`, async (c) => {
		const { conversation } = await conversationOf(c, "creator");
		return c.json(await removeConversation(conversation));
	});

	r.post(
		`${base}/:conversationId/messages`,
		json(
			z.object({
				text: z.string().min(1),
				mode: mode.default("manual"),
				effort: effort.optional(),
			}),
		),
		async (c) => {
			const { user, conversation } = await conversationOf(c, "creator");
			const body = c.req.valid("json");
			return c.json(
				await sendMessage(conversation, user.id, body.text, body.mode as never, body.effort),
				202,
			);
		},
	);

	// /compact [instructions]: 202 with the run to follow, or 200 when there is nothing to compact.
	r.post(
		`${base}/:conversationId/compact`,
		json(z.object({ instructions: z.string().max(2000).optional() })),
		async (c) => {
			const { user, conversation } = await conversationOf(c, "creator");
			const result = await compactConversation(
				conversation,
				user.id,
				c.req.valid("json").instructions?.trim() || undefined,
			);
			return c.json(result, result.runId ? 202 : 200);
		},
	);

	r.post(
		`${base}/:conversationId/approval`,
		json(
			z.union([
				z.object({
					approve: z.boolean(),
					reason: z.string().max(2000).optional(),
					mode: mode.optional(),
					effort: effort.optional(),
				}),
				z.object({
					decisions: z
						.array(
							z.object({
								toolCallId: z.string().min(1),
								approve: z.boolean(),
								reason: z.string().max(2000).optional(),
							}),
						)
						.min(1)
						.max(100),
					mode: mode.optional(),
					effort: effort.optional(),
				}),
			]),
		),
		async (c) => {
			const { user, conversation } = await conversationOf(c, "creator");
			return c.json(await answerApproval(conversation, user.id, c.req.valid("json") as never), 202);
		},
	);

	r.post(`${base}/:conversationId/stop`, async (c) => {
		const { conversation } = await conversationOf(c, "creator");
		return c.json(await stopRun(conversation), 202);
	});

	r.get(
		"/runs/:runId/stream",
		zValidator(
			"query",
			z.object({ afterSeq: z.coerce.number().int().min(-1).default(-1) }),
			zodErrorCallbackParser,
		),
		async (c) => {
			const run = await getRun(c.req.param("runId"));
			if (!run) throw new NotFoundError("Run not found");
			const conversation = await getConversation(run.conversationId);
			if (!conversation?.projectId) throw new NotFoundError("Run not found");
			const user = caller(c, conversation.projectId, "viewer");
			await owned(user, conversation.id);
			// Its stream then replays the `done` the release published and ends.
			await releaseIfOrphaned(run);
			return streamRun(c, run.id, c.req.valid("query").afterSeq);
		},
	);
}
