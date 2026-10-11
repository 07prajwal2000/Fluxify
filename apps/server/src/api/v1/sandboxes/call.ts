import { z } from "zod";
import { callBodySchema, devWorkerTarget, sendCall } from "../routes/call/service";
import { mustOwn } from "./service";

export { NO_DEV_WORKER } from "../routes/call/service";

export const sandboxCallSchema = callBodySchema.omit({ params: true }).extend({
	method: z
		.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
		.optional()
		.describe("POST when body is given, GET by default otherwise"),
	/** after `/_sandbox/<id>`; the sandbox's blocks see it as the request path */
	path: z.string().default("/"),
});

/**
 * One request to `/_sandbox/<id>/<path>` on the development worker, with the
 * project's development token added here. The token never leaves this
 * function: it is not in the answer, and the worker strips it before the
 * blocks run. Shared by sandboxes (#735) and ephemeral runs (#741).
 */
export async function callDevWorker(
	projectId: string,
	id: string,
	input: z.infer<typeof sandboxCallSchema>,
	requestOrigin: string,
	options: { timeoutSeconds?: number; abortAfterMs?: number } = {},
) {
	const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
	const { url, headers } = await devWorkerTarget(
		projectId,
		`/_sandbox/${id}${path}`,
		requestOrigin,
	);
	for (const [k, v] of Object.entries(input.query ?? {})) url.searchParams.set(k, v);

	const method = input.method ?? (input.body !== undefined ? "POST" : "GET");
	return sendCall(url, method, input, {
		target: { projectId, id },
		timeoutSeconds: options.timeoutSeconds ?? 30,
		abortAfterMs: options.abortAfterMs,
		headers,
	});
}

/** One request to a sandbox of yours (#735), the way call_route reaches a route. */
export async function callSandbox(
	projectId: string,
	id: string,
	userId: string,
	input: z.infer<typeof sandboxCallSchema>,
	requestOrigin: string,
) {
	await mustOwn(projectId, id, userId);
	const result = await callDevWorker(projectId, id, input, requestOrigin);
	return {
		...result,
		...(result.runId && {
			recording: `/v1/projects/${projectId}/sandboxes/${id}/runs/${result.runId}`,
		}),
	};
}
