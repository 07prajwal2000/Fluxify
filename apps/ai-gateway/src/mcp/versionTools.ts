import { z } from "zod";
import { deploymentDescription } from "../agent/deployment";
import type { CanvasItems } from "./canvasNormalize";
import { BASE } from "./canvasTools";
import { trimCanvas } from "./canvasView";
import { type McpTool, pick } from "./tools";

const KINDS = ["route", "workflow", "custom_block", "middleware"] as const;
type Kind = (typeof KINDS)[number];

const kind = z.enum(KINDS).describe("What the version belongs to");
const id = z
	.string()
	.describe(
		"The route, workflow, custom block or middleware id, from list_routes, list_workflows, list_custom_blocks or list_middlewares",
	);

/** Where each versioned kind lives in the admin API; a middleware has no canvas, so it is not in BASE. */
const ROOT: Record<Kind, string> = { ...BASE, middleware: "/v1/middlewares" };
const versionId = z.string().describe("Version id, from list_versions");

const COMMIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const CHECKOUT = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
const DEPLOY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

const base = (a: { kind: Kind; id: string }) => `${ROOT[a.kind]}/${a.id}/versions`;

const SUMMARY = [
	"versionNumber",
	"title",
	"description",
	"author",
	"createdAt",
	"isHead",
	"isProd",
];

/** A version as the tools show it: its id, number and title, and the version it came from. */
const summary = (v: Record<string, unknown>) => ({
	versionId: v.id,
	...pick(v, SUMMARY),
	parentVersionId: v.parentId,
});

const note = z
	.string()
	.max(2000)
	.optional()
	.describe(
		"A short note on what this puts live and why. It is saved after the person's own comment",
	);

/** What a deployment answers with: the log row, and the reasons when its checks stopped it. */
const deployment = (d: Record<string, any>) => ({
	deploymentId: d.id,
	...pick(d, ["action", "status", "versionNumber", "description", "gates", "createdAt"]),
	...(d.status === "failed"
		? {
				failed: d.gates
					.filter((g: { status: string }) => g.status === "failed")
					.map((g: { gate: string; message: string; items?: string[]; refs?: unknown[] }) => ({
						gate: g.gate,
						message: g.message,
						...(g.items ? { items: g.items } : {}),
						// the custom blocks to promote first, or the suites that failed, with ids
						...(g.refs ? { refs: g.refs } : {}),
					})),
			}
		: {}),
});

type DeployArgs = {
	kind: Kind;
	id: string;
	versionId: string;
	note?: string;
	/** the person's own words, put in by the agent's approval; it is not in the input schema */
	comment?: string;
};

/**
 * Promote and rollback (#739). One endpoint behind both: the server decides the
 * action from the version numbers, and rollback only refuses the wrong
 * direction, so it never quietly moves production forward.
 */
async function deploy(
	{ get, send }: Parameters<McpTool["call"]>[0],
	a: DeployArgs,
	direction: "promote" | "rollback",
) {
	if (direction === "rollback") {
		const target = await get(`${ROOT[a.kind]}/${a.id}`);
		const wanted = await get(`${base(a)}/${a.versionId}`);
		const live = target.prodVersionNumber as number | null;
		if (live === null)
			throw new Error(
				"Nothing is live in production yet, so there is nothing to roll back to. Use promote_version.",
			);
		if (wanted.versionNumber >= live)
			throw new Error(
				`rollback_version only goes back: v${wanted.versionNumber} is not older than v${live}, which is live. Use promote_version to put a newer version live.`,
			);
	}
	return deployment(
		await send("POST", `${ROOT[a.kind]}/${a.id}/deployments`, {
			versionId: a.versionId,
			description: deploymentDescription(a.comment, a.note),
		}),
	);
}

const DEPLOY_NOTE = [
	"Production serves what is promoted and nothing else: editing the working copy or committing never reaches it.",
	"Checks run first and any failure stops it, with the reasons: every integration and app config key the version uses needs a production value, no other route's live version may take the same method and path, and every custom block and middleware it uses needs a production version of its own (a failure lists them with ids: promote those first).",
	"A custom block or middleware is versioned like a route and works like a shared library: promoting or rolling one back changes every production route and workflow that uses it, and the checks run the tests of each of them with the new version in place. Development always runs the latest saved state of a block.",
	"A person approves every call, in every mode, and writes the reason that is saved with it. Never call it unless the user asked you to.",
].join(" ");

/**
 * Versions (#738): named snapshots of a route's or workflow's canvas and
 * settings. Committing never deploys; checking out changes the working copy
 * and nothing else. Promote and rollback (#739) are what put one in production.
 */
export const versionTools: McpTool[] = [
	{
		name: "commit_version",
		title: "Commit version",
		description: [
			"Save the route's, workflow's or custom block's canvas and settings (path, method, schemas, timeout, middlewares; a custom block's inputs), or a middleware's chain, as its next version, v1, v2, …",
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
			"The versions of a route, workflow, custom block or middleware, newest first: number, title, author, time, the version each came from, which one is the head (the one the working copy came from) and which one is live in production (isProd). uncommitted says the working copy has changes no version holds.",
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
	{
		name: "promote_version",
		title: "Promote version",
		description: [
			"Put a version live in production: it is what the route, workflow, custom block or middleware serves from now on, with production's values.",
			"Promote the version you committed and tested; list_versions shows which one is live (isProd).",
			DEPLOY_NOTE,
		].join(" "),
		role: "creator",
		annotations: DEPLOY,
		input: { kind, id, versionId, note },
		call: (api, a) => deploy(api, a, "promote"),
	},
	{
		name: "rollback_version",
		title: "Roll back version",
		description: [
			"Put an earlier version back live in production, after a bad promote. It must be older than the one live now; to move forward use promote_version.",
			"It is logged as a rollback and runs the same checks.",
			DEPLOY_NOTE,
		].join(" "),
		role: "creator",
		annotations: DEPLOY,
		input: { kind, id, versionId, note },
		call: (api, a) => deploy(api, a, "rollback"),
	},
];
