import { z } from "zod";
import type { AdminApi } from "./adminApi";
import { type CanvasOp, canvasOpSchema, opsToChanges, trimCanvas } from "./canvasOps";
import type { McpTool } from "./tools";

/** Where each canvas kind lives in the admin API. Middlewares have no canvas. */
const BASE = { route: "/v1/routes", workflow: "/v1/workflows", custom_block: "/v1/custom-blocks" };

const target = z
	.object({
		kind: z.enum(["route", "workflow", "custom_block"]),
		id: z.string().describe("The route, workflow or custom block id"),
	})
	.describe("Whose canvas. Middlewares have none: use save_middleware.");

type Target = z.infer<typeof target>;

const read = (get: AdminApi["get"], t: Target) => get(`${BASE[t.kind]}/${t.id}/canvas-items`);

const STALE = "Canvas changed since you read it. Read it again with get_canvas and redo the edit.";

export const canvasTools: McpTool[] = [
	{
		name: "get_canvas",
		description:
			"The blocks and edges of a route, workflow or custom block canvas, and its version. Pass the version to edit_canvas. Block data contracts: get_block_schemas.",
		role: "viewer",
		input: { target },
		call: async ({ get }, a) => trimCanvas(await read(get, a.target)),
	},
	{
		name: "edit_canvas",
		description: [
			"Change a canvas in small steps, applied in order and saved together. It never runs anything.",
			"Ops: add_block {ref, type, data, position?, connect_from?}; update_block {id, data} (only changed fields, merged);",
			"remove_block {id} (its edges go too); connect / disconnect {from, to, handle?}.",
			"from/to take block ids or refs added earlier in the same call. A handle left out uses the block's default.",
			"A handle holds one edge (switch case and orchestrate excepted): disconnect before re-pointing it.",
			"Bad ops, unknown block types, missing ids and broken edges are refused and nothing is saved.",
			"It always returns rule errors and warnings (issues); errors that block a save refuse it, warnings still save. validate: false skips them. Empty ops checks without saving.",
			"Block text inputs are literal unless they start with `js:` followed by code that returns the value (e.g. `js: return input.id`); never use `{{ }}`.",
			"Returns the new version and the id of each ref.",
		].join(" "),
		role: "creator",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
		input: {
			target,
			version: z.number().int().min(0).describe("The version from get_canvas"),
			ops: z.array(canvasOpSchema),
			auto_layout: z.boolean().optional().describe("Re-lay out the whole canvas"),
			validate: z.boolean().optional().describe("false: skip returning rule issues. On by default"),
		},
		call: async ({ get, send }, a) => {
			const ops = a.ops as CanvasOp[];
			const canvas = await read(get, a.target);
			if (canvas.canvasVersion !== a.version) throw new Error(STALE);
			const { changes, refs } = opsToChanges(canvas, ops, a.auto_layout);
			// nothing to change: at most a check, never a save
			const checkOnly = ops.length === 0 && !a.auto_layout;
			const validate = a.validate !== false;
			if (checkOnly && !validate) return { version: a.version };
			const query = `expectedVersion=${a.version}${checkOnly ? "&dryRun=true" : ""}`;
			const path = `${BASE[(a.target as Target).kind]}/${a.target.id}/save-canvas?${query}`;
			const result = await send("PUT", path, changes).catch((error: Error) => {
				throw error.message.includes("Canvas changed") ? new Error(STALE) : error;
			});
			return {
				version: result.canvasVersion,
				...(Object.keys(refs).length ? { refs } : {}),
				...(validate && result.issues?.length ? { issues: result.issues } : {}),
			};
		},
	},
];
