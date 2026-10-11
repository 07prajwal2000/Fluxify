import { z } from "zod";
import type { CanvasItems } from "./canvasNormalize";
import { BASE } from "./canvasTools";
import { trimCanvas } from "./canvasView";
import { type McpTool, pick } from "./tools";

const kind = z.enum(["route", "workflow"]).describe("What the version belongs to");
const id = z.string().describe("The route or workflow id, from list_routes or list_workflows");
const versionId = z.string().describe("Version id, from list_versions");

const COMMIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const CHECKOUT = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

const base = (a: { kind: "route" | "workflow"; id: string }) => `${BASE[a.kind]}/${a.id}/versions`;

const SUMMARY = ["versionNumber", "title", "description", "author", "createdAt", "isHead"];

/** A version as the tools show it: its id, number and title, and the version it came from. */
const summary = (v: Record<string, unknown>) => ({
	versionId: v.id,
	...pick(v, SUMMARY),
	parentVersionId: v.parentId,
});

/**
 * Versions (#738): named snapshots of a route's or workflow's canvas and
 * settings. Committing never deploys; checking out changes the working copy
 * and nothing else.
 */
export const versionTools: McpTool[] = [
	{
		name: "commit_version",
		title: "Commit version",
		description: [
			"Save the route's or workflow's canvas and settings (path, method, schemas, timeout, middlewares) as its next version, v1, v2, …",
			'Always give a meaningful title that says what the work is ("Add rate limiting"), not "update".',
			"Committing never deploys or compiles anything; development already runs your edits as you save them.",
			'Commit when a piece of work is done and tested. Refused with "Nothing to commit" when nothing changed since the last version.',
		].join(" "),
		role: "creator",
		annotations: COMMIT,
		input: {
			kind,
			id,
			title: z.string().min(1).max(255).describe("What this version is. Required, and meaningful"),
			description: z
				.string()
				.max(5000)
				.optional()
				.describe("More detail, if the title is not enough"),
		},
		call: async ({ send }, a) =>
			summary(await send("POST", base(a), { title: a.title, description: a.description })),
	},
	{
		name: "list_versions",
		title: "List versions",
		description:
			"A route's or workflow's versions, newest first: number, title, author, time, the version each came from, and which one is the head (the one the working copy came from). uncommitted says the working copy has changes no version holds.",
		role: "viewer",
		input: { kind, id },
		call: async ({ get }, a) => {
			const body = await get(base(a));
			return { uncommitted: body.uncommitted, versions: body.versions.map(summary) };
		},
	},
	{
		name: "get_version",
		title: "Get version",
		description: [
			"One version's canvas, shown the way get_canvas shows one, and its settings (path, method, schemas, timeout, middleware ids).",
			"On a big canvas pass compact: true, then blocks: [keys] for the full data of just those blocks.",
			"It is read-only and has no revision: edit the working copy with get_canvas and edit_canvas, or bring this version back with checkout_version.",
		].join(" "),
		role: "viewer",
		input: {
			kind,
			id,
			versionId,
			compact: z.boolean().optional().describe("Key, type, note and a one-line summary per block"),
			blocks: z
				.array(z.string())
				.optional()
				.describe("Block keys: full data for just these blocks and the edges touching them"),
		},
		call: async ({ get }, a) => {
			const v = await get(`${base(a)}/${a.versionId}`);
			const { revision: _, ...canvas } = trimCanvas(
				{ blocks: v.snapshot.blocks, edges: v.snapshot.edges, canvasRevision: 0 } as CanvasItems & {
					canvasRevision: number;
				},
				a,
			);
			return { ...summary(v), settings: v.snapshot.settings, ...canvas };
		},
	},
	{
		name: "checkout_version",
		title: "Check out version",
		description: [
			"Make an earlier version the working copy: its canvas and settings replace what is there, and the next commit comes from it.",
			'Uncommitted work is saved first as a new version, so nothing is lost; give it a meaningful title, or it is named "Saved before checking out vN".',
			"Block ids and keys stay the same. Development recompiles the restored canvas; nothing is deployed.",
			"Refused when the version's path and method now belong to another route. Returns the new revision for edit_canvas.",
		].join(" "),
		role: "creator",
		annotations: CHECKOUT,
		input: {
			kind,
			id,
			versionId,
			title: z
				.string()
				.min(1)
				.max(255)
				.optional()
				.describe("Names the version that saves uncommitted work first, if there is any"),
		},
		call: async ({ send }, a) => {
			const out = await send("POST", `${base(a)}/${a.versionId}/checkout`, { title: a.title });
			return {
				checkedOut: summary(out.checkedOut),
				...(out.savedVersion ? { savedVersion: summary(out.savedVersion) } : {}),
				revision: out.canvasRevision,
				...(out.warnings.length ? { warnings: out.warnings } : {}),
			};
		},
	},
];
