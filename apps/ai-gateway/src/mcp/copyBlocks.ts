import { BlockTypes } from "@fluxify/blocks/blockTypes";
import { z } from "zod";
import type { AdminApi } from "./adminApi";
import { bare, STRUCTURAL } from "./canvasDraft";
import { nameBlocks } from "./canvasNames";
import type { CanvasItems } from "./canvasNormalize";
import { type CanvasOp, opsToChanges } from "./canvasOps";
import { BASE, canvasPath, read, type Target } from "./canvasTools";
import { type McpTool, projectId } from "./tools";

/** `to` value that makes a new sandbox named after the source (#752). */
export const NEW_SANDBOX = "__new_sandbox__";

const kind = z.enum(["route", "workflow", "custom_block", "sandbox"]);
const canvasRef = z.object({
	kind,
	id: z.string().describe("The route, workflow, custom block or sandbox id"),
});
type CanvasRef = z.infer<typeof canvasRef>;

/** The project check: a canvas is read through its resource, so the record says where it lives. */
async function describeCanvas(get: AdminApi["get"], project: string, ref: CanvasRef) {
	const path =
		ref.kind === "sandbox"
			? `/v1/projects/${project}/sandboxes/${ref.id}`
			: `${BASE[ref.kind]}/${ref.id}`;
	const info = await get(path);
	if (info.projectId !== project)
		throw new Error(
			`That ${ref.kind.replace("_", " ")} is in another project. copy_blocks works inside one project.`,
		);
	return info as {
		name: string | null;
		bodySchema?: unknown;
		querySchema?: unknown;
		paramsSchema?: unknown;
	};
}

const hasSchema = (s: unknown) =>
	!!s && (typeof s !== "object" || Object.keys(s as object).length > 0);

/**
 * The blocks a copy or an ephemeral run takes from a canvas: the chosen keys
 * (none = all), never the entrypoint or error handler, with the edges between
 * them. The block the entrypoint led to comes first. Reads the source the way
 * get_canvas does, so another person's sandbox is a 404 and another project's
 * canvas is refused.
 */
export async function loadSource(api: AdminApi, project: string, from: CanvasRef, keys?: string[]) {
	const info = await describeCanvas(api.get, project, from);
	const canvas: CanvasItems = await read(api.get, { ...from, projectId: project });
	const keyOf = (b: CanvasItems["blocks"][number]) => b.key ?? b.id;
	const known = new Set(canvas.blocks.map(keyOf));
	const unknown = keys?.filter((k) => !known.has(k)) ?? [];
	if (unknown.length)
		throw new Error(
			`No block ${unknown.join(", ")} on that canvas. Keys: ${[...known].join(", ")}.`,
		);

	const chosen = keys && new Set(keys);
	const blocks = canvas.blocks.filter(
		(b) => !STRUCTURAL.has(b.type) && (!chosen || chosen.has(keyOf(b))),
	);
	if (!blocks.length)
		throw new Error("Nothing to copy: the entrypoint and error handler are never copied.");
	const ids = new Set(blocks.map((b) => b.id));
	const edges = canvas.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

	const entry = canvas.blocks.find((b) => b.type === BlockTypes.entrypoint);
	const entryTo = canvas.edges.find((e) => e.from === entry?.id)?.to;
	const isHead = (b: (typeof blocks)[number]) =>
		b.id === entryTo || (b.type !== BlockTypes.sticky_note && !edges.some((e) => e.to === b.id));
	const head = blocks.find((b) => b.id === entryTo) ?? blocks.find(isHead);
	if (head) blocks.splice(0, blocks.length, head, ...blocks.filter((b) => b !== head));

	const warnings: string[] = [];
	if (from.kind === "custom_block")
		warnings.push(
			"These blocks may read the custom block's inputs, which do not exist outside it. Read the request body (or the run payload) instead.",
		);
	if (from.kind === "route") {
		const middlewares = await api
			.get(`${BASE.route}/${from.id}/middlewares`)
			.catch(() => ({ before: [], after: [] }));
		if (middlewares.before?.length || middlewares.after?.length)
			warnings.push("The route's middlewares are not copied: they are route settings, not blocks.");
		if ([info.bodySchema, info.querySchema, info.paramsSchema].some(hasSchema))
			warnings.push(
				"The route's request schemas are not copied: a sandbox accepts any body, query and params.",
			);
	}
	return {
		name: info.name ?? from.kind.replace("_", " "),
		canvas,
		blocks,
		edges,
		head,
		warnings,
		keyOf,
	};
}

export const copyBlocksTool: McpTool = {
	name: "copy_blocks",
	title: "Copy blocks",
	description: [
		"Copy blocks from one canvas to another in the same project: the debug loop is copy a route into a sandbox, fix it there, copy the fix back.",
		'from and to are { kind: route | workflow | custom_block | sandbox, id }; a sandbox must be yours. to may also be "__new_sandbox__": it makes a sandbox named "<name> sandbox" first and connects its entrypoint to the copy (never a route or workflow).',
		"keys are the block keys from get_canvas; leave them out to copy the whole canvas. The entrypoint and error handler are never copied, and an edge to a block you did not copy is dropped.",
		"connect_from { from, handle? } is a block on the target; it is connected to the first copied block. Without it the copy sits unconnected. position moves the copy there.",
		"Saved in one go with the usual canvas checks: a refused copy changes nothing. Copying into a route, workflow or custom block asks the user first, even in auto mode; into a sandbox it does not.",
		"Returns target, keys (each source key → the key the copy got), revision, issues (rule warnings) and warnings (what was not copied or may not work, e.g. route middlewares, request schemas, a custom block's inputs).",
	].join(" "),
	role: "creator",
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
	input: {
		projectId,
		from: canvasRef,
		keys: z.array(z.string()).optional().describe("Block keys to copy; omit for the whole canvas"),
		to: z.union([z.literal(NEW_SANDBOX), canvasRef]),
		connect_from: z
			.object({ from: z.string(), handle: z.string().optional() })
			.optional()
			.describe("A block on the target (key, or key.handle) to connect to the copy"),
		position: z
			.object({ x: z.number(), y: z.number() })
			.optional()
			.describe("Where the copy's top-left goes; omit and the server places it"),
	},
	call: async (api, a) => {
		const project = a.projectId as string;
		const src = await loadSource(api, project, a.from, a.keys);
		const into: CanvasRef | undefined = a.to === NEW_SANDBOX ? undefined : a.to;
		if (into) await describeCanvas(api.get, project, into);

		const sandboxes = `/v1/projects/${project}/sandboxes`;
		let target: Target;
		let created = false;
		if (into) {
			target = { ...into, projectId: project };
		} else {
			const { id } = await api.send("POST", sandboxes, {
				name: `${src.name} sandbox`.slice(0, 255),
			});
			target = { kind: "sandbox", id, projectId: project };
			created = true;
		}
		try {
			const canvas = await read(api.get, target);
			const ref = new Map(src.blocks.map((b, i) => [b.id, `copy_${i + 1}`]));
			const minX = Math.min(...src.blocks.map((b) => b.position.x));
			const minY = Math.min(...src.blocks.map((b) => b.position.y));
			const entry = canvas.blocks.find(
				(b: CanvasItems["blocks"][number]) => b.type === BlockTypes.entrypoint,
			);
			const connect =
				a.connect_from ?? (created && entry ? { from: entry.key ?? entry.id } : undefined);

			const ops: CanvasOp[] = src.blocks.map((b) => {
				const data = { ...(b.data as Record<string, unknown>) };
				// a fan-out block lists its branches by target id: point it at the copies
				if (Array.isArray(data.order))
					data.order = (data.order as string[]).flatMap((id) => ref.get(id) ?? []);
				return {
					op: "add_block",
					ref: ref.get(b.id)!,
					type: b.type,
					data,
					...(a.position && {
						position: {
							x: b.position.x - minX + a.position.x,
							y: b.position.y - minY + a.position.y,
						},
					}),
					...(connect && b === src.head && { connect_from: connect }),
				};
			});
			for (const e of src.edges)
				ops.push({
					op: "connect",
					from: ref.get(e.from)!,
					to: ref.get(e.to)!,
					handle: bare(e.from, e.fromHandle ?? "source"),
				});

			const { changes, refs } = opsToChanges(canvas, ops);
			// the order lists hold refs for now; the ids exist only after opsToChanges
			const added = new Set(Object.values(refs));
			for (const b of changes.changes.blocks) {
				const data = b.data as Record<string, unknown>;
				if (added.has(b.id) && Array.isArray(data.order))
					data.order = (data.order as string[]).map((r) => refs[r] ?? r);
			}
			const names = nameBlocks(canvas, refs);
			const result = await api
				.send(
					"PUT",
					`${canvasPath(target)}/save-canvas?expectedRevision=${(canvas as any).canvasRevision}`,
					changes,
				)
				.catch((error: Error) => {
					throw new Error(names.keyed(error.message));
				});
			const { keys, keyed } = nameBlocks(canvas, refs, result.newKeys);
			const keyOf = Object.fromEntries(src.blocks.map((b) => [src.keyOf(b), keys[ref.get(b.id)!]]));
			const issues = (result.issues ?? []).map((i: { message: string; severity: string }) => ({
				severity: i.severity,
				message: keyed(i.message),
			}));
			return {
				target: {
					kind: target.kind,
					id: target.id,
					...(created && { name: `${src.name} sandbox` }),
				},
				revision: result.canvasRevision,
				keys: keyOf,
				...(src.warnings.length && { warnings: src.warnings }),
				...(issues.length && { issues }),
			};
		} catch (error) {
			// all or nothing: a sandbox made for this copy goes with it
			if (created) await api.send("DELETE", `${sandboxes}/${target.id}`).catch(() => {});
			throw error;
		}
	},
};
