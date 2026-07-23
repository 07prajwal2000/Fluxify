import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import { getCache, NotFoundError, ServerError } from "@fluxify/server";
import {
	conversationEventEmitter,
	type ConversationWorkflowStatus,
} from "../../../../workflow/queue";
import { getConversationKey } from "../../../../workflow/index";

export default async function handleWatchRequest(
	c: Context,
	conversationId: string,
) {
	const redisKey = getConversationKey(conversationId);

	const cacheData = await getCache(redisKey);

	if (!cacheData) {
		return streamSSE(c, async (stream) => {
			await stream.writeSSE({
				data: JSON.stringify({ status: "success", conversationId, executionHistory: [] }),
			});
			await stream.close();
		});
	}

	let initialStatus: ConversationWorkflowStatus;
	try {
		initialStatus = JSON.parse(cacheData).status;
	} catch (e) {
		throw new ServerError("Failed to parse cached workflow status");
	}

	return streamSSE(c, async (stream) => {
		await new Promise<void>(async (resolve) => {
			let isClientConnected = true;

			const cleanup = () => {
				if (isClientConnected) {
					isClientConnected = false;
					conversationEventEmitter.off(conversationId, onUpdate);
					resolve();
				}
			};

			const onUpdate = async (status: ConversationWorkflowStatus) => {
				if (!isClientConnected) return;

				try {
					await stream.writeSSE({
						data: JSON.stringify(status),
					});

					if (status.status === "error" || status.status === "success") {
						cleanup();
						await stream.close();
					}
				} catch (err) {
					cleanup();
				}
			};

			// Send current data available in Redis
			try {
				await stream.writeSSE({
					data: JSON.stringify(initialStatus),
				});

				if (
					initialStatus.status === "error" ||
					initialStatus.status === "success"
				) {
					await stream.close();
					resolve();
					return;
				}
			} catch (e) {
				resolve();
				return;
			}

			conversationEventEmitter.on(conversationId, onUpdate);

			stream.onAbort(() => {
				cleanup();
			});

			c.req.raw.signal.addEventListener("abort", () => {
				cleanup();
			});
		});
	});
}
