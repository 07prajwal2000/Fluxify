import { logger } from "@fluxify/common";
import type { z } from "zod";
import { ConflictError } from "../../../errors/conflictError";
import { getProjectSetting } from "../../../lib/project-settings";
import {
	compileEphemeral,
	dropEphemeral,
	newEphemeralId,
	publishEphemeral,
} from "../../../modules/compiler/ephemeral";
import { devWorkerOnline } from "../../../modules/orchestrator/status";
import { DEBUG_ERROR_HEADER, DEBUG_TOKEN_HEADER } from "../../../modules/requestRouter/debugError";
import { DEBUG_TRACE_HEADER } from "../../../modules/requestRouter/debugTrace";
import { type callResultSchema, NEVER_LOADED_ERROR } from "../routes/call/service";
import { callDevWorker, NO_DEV_WORKER } from "../sandboxes/call";
import {
	DEFAULT_TIMEOUT_SECONDS,
	MAX_TIMEOUT_SECONDS,
	MIN_TIMEOUT_SECONDS,
	type RunBody,
} from "./dto";
import { buildEphemeralGraph } from "./graph";
import { writeEphemeralLog } from "./log";

type Called = z.infer<typeof callResultSchema>;

const clamp = (seconds: number) =>
	Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, Math.round(seconds)));

/**
 * The wait for one run: the call's own, else the project's setting, else 10 —
 * always inside 1–30, whichever of them said it.
 */
export async function runTimeoutSeconds(projectId: string, requested?: number) {
	if (requested !== undefined) return clamp(requested);
	const setting = Number(
		await getProjectSetting(projectId, "settings.ai.ephemeralRunTimeoutSeconds"),
	);
	return clamp(setting || DEFAULT_TIMEOUT_SECONDS);
}

/**
 * The worker loads artifacts from a KV watch, so the first call after the put
 * can land before it has this one: a 404. The same goes for a project's very
 * first development token, whose hash reaches the worker the same way: a 401.
 * Either comes with no trace (a graph that ran, even one answering 404 or 401,
 * always has one), so only those are tried again, with a short backoff, inside
 * the same deadline.
 */
export async function callWhenLoaded(
	projectId: string,
	id: string,
	body: RunBody,
	origin: string,
	deadline: number,
): Promise<Called> {
	for (let wait = 50; ; wait = Math.min(wait * 2, 400)) {
		const remaining = Math.max(deadline - Date.now(), 1);
		const result = await callDevWorker(projectId, id, { ...body, debug: true }, origin, {
			abortAfterMs: remaining,
		});
		const notLoaded = (result.status === 404 || result.status === 401) && !result.debugTrace;
		if (!notLoaded) return result;
		// Time ran out while the worker still had not loaded this run: a 404/401
		// with no trace means the artifact never arrived, almost always because
		// the worker's KV watch is down (#789). Name the cause instead of the
		// raw 404.
		if (Date.now() + wait >= deadline) return { ...result, error: NEVER_LOADED_ERROR };
		await Bun.sleep(wait);
	}
}

/** The artifact must not outlive the call, so a failed delete is tried again before it is given up. */
async function dropWithRetry(projectId: string, id: string) {
	for (let attempt = 1; ; attempt++) {
		try {
			return await dropEphemeral(projectId, id);
		} catch (error) {
			if (attempt === 3) {
				logger.error(
					`[ephemeral] could not delete ${id} from the development bucket`,
					"EPHEMERAL",
					{
						error,
					},
				);
				return;
			}
			await Bun.sleep(100 * attempt);
		}
	}
}

/**
 * One call that runs a few blocks and leaves nothing behind (#741). The graph is
 * checked like a canvas save (400 with the reasons), compiled in memory and put
 * in the development bucket for this call only, run once on the development
 * worker, and deleted again, on success, failure and timeout alike. No sandbox,
 * block, edge or recording row is ever written; the run's one `ephemeral`
 * system log row is the only thing kept.
 */
export async function runEphemeral(
	projectId: string,
	userId: string,
	body: RunBody,
	origin: string,
) {
	const timeoutSeconds = await runTimeoutSeconds(projectId, body.timeoutSeconds);
	// before the compile, which would otherwise be for nothing
	if (!(await devWorkerOnline(projectId))) throw new ConflictError(NO_DEV_WORKER);

	const method = body.method ?? (body.body !== undefined ? "POST" : "GET");
	const runBody = { ...body, method };
	const { blocks, edges, warnings, names } = await buildEphemeralGraph(projectId, userId, runBody);
	const id = newEphemeralId();
	const artifact = await compileEphemeral({ projectId, id, blocks, edges, timeoutSeconds });

	const startedAt = performance.now();
	const deadline = Date.now() + timeoutSeconds * 1000;
	let result: Called;
	try {
		await publishEphemeral(artifact);
		result = await callWhenLoaded(projectId, id, runBody, origin, deadline);
	} finally {
		await dropWithRetry(projectId, id);
	}
	const durationMs = Math.round(performance.now() - startedAt);

	// the abort is the timeout: say so, instead of "could not reach"
	if (result.status === null && durationMs >= timeoutSeconds * 1000 - 50)
		result = {
			...result,
			error: `The run did not finish within ${timeoutSeconds} seconds. Raise timeoutSeconds (up to ${MAX_TIMEOUT_SECONDS}), or give the blocks less to do.`,
		};
	// the debug headers are for this call's own decoding, not for the caller
	const headers = Object.fromEntries(
		Object.entries(result.headers ?? {}).filter(
			([name]) => ![DEBUG_TOKEN_HEADER, DEBUG_ERROR_HEADER, DEBUG_TRACE_HEADER].includes(name),
		),
	);
	// the entrypoint is the one block whose id the caller never chose
	const named = (id: string) => names[id] ?? id;
	const answer: Called & { durationMs: number } = {
		...result,
		headers,
		durationMs,
		...(result.debugError?.block && {
			debugError: {
				...result.debugError,
				block: { ...result.debugError.block, id: named(result.debugError.block.id) },
			},
		}),
		...(result.debugTrace && {
			debugTrace: {
				...result.debugTrace,
				spans: result.debugTrace.spans.map((s) => ({ ...s, blockId: named(s.blockId) })),
			},
		}),
	};
	const { runId: _runId, ...visible } = answer;

	await writeEphemeralLog({ projectId, userId, id, answer });
	return {
		...visible,
		id,
		...(warnings.length ? { warnings } : {}),
	};
}
