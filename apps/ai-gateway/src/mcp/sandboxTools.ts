import { z } from "zod";
import { bare } from "./canvasDraft";
import { copyBlocksTool, loadSource } from "./copyBlocks";
import { blockKeys, MAX_RESPONSE_CHARS, traceLines, truncate, withBlockKey } from "./routeTools";
import { type McpTool, pick, projectId } from "./tools";

const SAVE = { readOnlyHint: false, destructiveHint: false };
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
/** A call runs the graph for real, on development data: it can write, send and call out. */
const RUN = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

const sandboxId = z.string().describe("Sandbox id, from list_sandboxes");
const base = (a: { projectId: string }) => `/v1/projects/${a.projectId}/sandboxes`;
const fields = ["id", "name", "settings", "updatedAt"];

/**
 * Sandboxes (#735): your own scratch canvases, run on a development worker with
 * development values. Every tool goes through the sandbox endpoints, which
 * answer 404 to anyone but the owner, so an agent acting as you sees only yours.
 */
export const sandboxTools: McpTool[] = [
	{
		name: "list_sandboxes",
		title: "List sandboxes",
		description:
			"Your sandboxes in a project: private scratch canvases that run on development data. Other people's are never listed.",
		role: "creator",
		input: { projectId },
		call: async ({ get }, a) =>
			(await get(base(a))).data.map((s: Record<string, unknown>) => pick(s, fields)),
	},
	{
		name: "get_sandbox",
		title: "Get sandbox",
		description:
			"One of your sandboxes: name and settings. Its canvas comes from get_canvas with target { kind: 'sandbox', id, projectId }.",
		role: "creator",
		input: { projectId, sandboxId },
		call: async ({ get }, a) => pick(await get(`${base(a)}/${a.sandboxId}`), fields),
	},
	{
		name: "create_sandbox",
		title: "Create sandbox",
		description:
			"Create a sandbox: a private canvas to try blocks on development data (inspect a table with DB Native, test a custom block) without touching real routes. It starts with an entrypoint. Build it with get_canvas and edit_canvas (target { kind: 'sandbox', id, projectId }), then call_sandbox or run_sandbox.",
		role: "creator",
		annotations: SAVE,
		input: { projectId, name: z.string().min(1).max(255) },
		call: async ({ send }, a) => send("POST", base(a), { name: a.name }),
	},
	{
		name: "delete_sandbox",
		title: "Delete sandbox",
		description: "Delete one of your sandboxes, its canvas, its runs and its triggers.",
		role: "creator",
		annotations: DELETE,
		input: { projectId, sandboxId },
		call: async ({ send }, a) => {
			await send("DELETE", `${base(a)}/${a.sandboxId}`);
			return { deleted: a.sandboxId };
		},
	},
	{
		name: "call_sandbox",
		title: "Call sandbox",
		description: `Send a REAL HTTP request to your sandbox on a development worker: any method, any path (the blocks see it as the request path), any body. It runs on development data and can still write it. The development token is added for you. Returns status, headers and body (cut at ${MAX_RESPONSE_CHARS} characters), runId and recording (read the run with get_recording, kind 'sandbox'). When it fails, error has the real cause; trace lists the blocks that ran. Without a development worker it says how to start one.`,
		role: "creator",
		annotations: RUN,
		input: {
			projectId,
			sandboxId,
			method: z
				.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
				.optional()
				.describe("POST when body is given, GET by default otherwise"),
			path: z.string().optional().describe("After /_sandbox/<id>, e.g. /users/1. / by default"),
			query: z.record(z.string(), z.string()).optional(),
			headers: z.record(z.string(), z.string()).optional(),
			body: z.unknown().optional().describe("JSON body; a string is sent as-is"),
		},
		call: async ({ get, send }, { projectId: p, sandboxId: id, ...a }) => {
			const { debugError, debugTrace, ...result } = await send(
				"POST",
				`${base({ projectId: p })}/${id}/call`,
				{ ...a, debug: true },
			);
			const target = { kind: "sandbox" as const, id, projectId: p };
			const keys = debugError || debugTrace ? await blockKeys(get, target) : new Map();
			return {
				...result,
				body: truncate(result.body),
				...(debugError && { error: withBlockKey(keys, debugError) }),
				...(debugTrace && { trace: traceLines(keys, debugTrace) }),
			};
		},
	},
	{
		name: "run_blocks",
		title: "Run blocks",
		description: `Try a few blocks in ONE call and leave nothing behind: no sandbox, no recording, no saved canvas. The blocks run once on a development worker with development data, so they can still write it. Give blocks as { ref, type, data } and edges as { from, to, handle? } (from may be "ref.handle"), the way edit_canvas names them, but by refs you choose. The entrypoint and error handler are added for you, and the entrypoint goes to the first block nothing points at. input is the request body the blocks read. Returns status, headers, body (cut at ${MAX_RESPONSE_CHARS} characters), durationMs, and the blocks that ran as trace. A bad graph is refused with the reasons; a failing block comes back as error with its ref, message and stack. It waits timeoutSeconds (1-30; the project's setting by default, 10), then gives up. The run is kept only as one system log (type ephemeral, id returned) that only you can read. Without a development worker it says how to start one. Instead of blocks, from { kind, id } runs a canvas that already exists (a route, workflow, custom block or your sandbox of this project), or just the blocks named in keys, as it is saved: nothing is changed or kept. Its entrypoint's request is what input, method, path and headers set. To keep what you build, use a sandbox or a real route.`,
		role: "creator",
		annotations: RUN,
		input: {
			projectId,
			blocks: z
				.array(
					z.object({
						ref: z.string().describe('Your name for the block: letters, digits, _ ("fetch_user")'),
						type: z
							.string()
							.describe("Block type from get_block_schemas, or a custom block's name"),
						data: z.record(z.string(), z.unknown()).optional().describe("The block's settings"),
					}),
				)
				.min(1)
				.optional()
				.describe("Give blocks, or from"),
			edges: z
				.array(
					z.object({
						from: z.string().describe('A ref, or "ref.handle" such as "check.success"'),
						to: z.string(),
						handle: z
							.string()
							.optional()
							.describe("Output handle on the from block; omit for its default"),
					}),
				)
				.optional(),
			from: z
				.object({ kind: z.enum(["route", "workflow", "custom_block", "sandbox"]), id: z.string() })
				.optional()
				.describe("Run this existing canvas instead of blocks"),
			keys: z.array(z.string()).optional().describe("With from: only these block keys"),
			input: z.unknown().optional().describe("The request body the blocks read"),
			method: z
				.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
				.optional()
				.describe("POST when input is given, GET by default otherwise"),
			path: z.string().optional().describe("The request path the blocks see. / by default"),
			headers: z.record(z.string(), z.string()).optional(),
			timeoutSeconds: z.number().optional().describe("Seconds to wait, 1-30"),
		},
		call: async (api, { projectId: p, input, from, keys, ...a }) => {
			if (!from === !a.blocks) throw new Error("Give either blocks or from, not both or neither.");
			let warnings: string[] = [];
			if (from) {
				// a saved canvas, as blocks and edges by key; the server adds the entrypoint
				const src = await loadSource(api, p, from, keys);
				warnings = src.warnings;
				a.blocks = src.blocks.map((b) => ({
					ref: src.keyOf(b),
					type: b.type,
					data: b.data,
				}));
				a.edges = src.edges.map((e) => ({
					from: src.keyOf(src.blocks.find((b) => b.id === e.from)!),
					to: src.keyOf(src.blocks.find((b) => b.id === e.to)!),
					handle: bare(e.from, e.fromHandle ?? "source"),
				}));
			}
			const { debugError, debugTrace, ...result } = await api.send(
				"POST",
				`/v1/projects/${p}/ephemeral-runs`,
				{ ...a, body: input },
			);
			// the server answers with the refs the caller chose, so a key is the ref
			const refs = new Map<string, string>(
				(a.blocks as { ref: string }[]).map((b) => [b.ref, b.ref]),
			);
			return {
				...result,
				body: truncate(result.body),
				...(debugError && { error: withBlockKey(refs, debugError) }),
				...(debugTrace && { trace: traceLines(refs, debugTrace) }),
				...(warnings.length && { warnings }),
			};
		},
	},
	{
		name: "run_sandbox",
		title: "Run sandbox",
		description:
			"Run your sandbox once as a workflow on a development worker, with payload as the trigger's data. Returns the job id at once; the run is recorded (list_recordings, kind 'sandbox').",
		role: "creator",
		annotations: RUN,
		input: { projectId, sandboxId, payload: z.unknown().optional() },
		call: async ({ send }, a) =>
			send("POST", `${base(a)}/${a.sandboxId}/run`, { payload: a.payload }),
	},
	copyBlocksTool,
];
