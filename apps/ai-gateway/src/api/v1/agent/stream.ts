import { logger } from "@fluxify/common";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { type AgentEvent, isEnd, unseen } from "../../../agent/runner/events";
import { readRunEvents } from "../../../agent/runner/queue";
import { getRun, SETTLED } from "../../../agent/runner/repository";

/** Writes every event the client does not have until `done` or `error`; true when one came. */
export async function relay(
	source: AsyncIterable<AgentEvent[]>,
	afterSeq: number,
	write: (e: AgentEvent) => Promise<void>,
) {
	for await (const batch of source)
		for (const e of unseen(batch, afterSeq)) {
			await write(e);
			if (isEnd(e)) return true;
		}
	return false;
}

const HEARTBEAT_MS = 15_000;

/**
 * SSE of a run: replays `agent.run.<runId>` from its first batch, then
 * follows it live, skipping events of messages the client already loaded
 * (seq <= afterSeq). Ends on done/error. If the run settled without the
 * client seeing `done` (expired events, a worker that died), a status check
 * soon after opening and on every heartbeat ends it with a `done` of its own.
 */
export function streamRun(c: Context, runId: string, afterSeq: number) {
	return streamSSE(c, async (s) => {
		const reader = await readRunEvents(runId);
		let settled: AgentEvent | undefined;
		const check = async () => {
			const run = await getRun(runId).catch(() => undefined);
			if (run && SETTLED.includes(run.status)) {
				settled = { type: "done", seq: -1, status: run.status };
				await reader.stop();
			}
		};
		const write = (e: AgentEvent) => s.writeSSE({ event: e.type, data: JSON.stringify(e) });
		const first = setTimeout(check, 2000);
		const beat = setInterval(() => {
			void s.write(": ping\n\n");
			void check();
		}, HEARTBEAT_MS);
		s.onAbort(() => void reader.stop());
		try {
			const ended = await relay(reader, afterSeq, write);
			if (!ended && settled && !s.aborted) await write(settled);
		} catch (error) {
			logger.error("[AgentStream] stream failed", { runId, error });
		} finally {
			clearTimeout(first);
			clearInterval(beat);
			await reader.stop().catch(() => {});
		}
	});
}
