import { BlockTypes } from "@fluxify/blocks";
import { getOutputHandles, type HandleSpec } from "@fluxify/blocks/blockHandles";
import { generateID } from "@fluxify/lib";
import { db } from "../../../db";
import { BadRequestError } from "../../../errors/badRequestError";
import { ConflictError } from "../../../errors/conflictError";
import { blockDataValidator } from "../../../modules/canvas/blockDataValidator";
import { rememberDroppedWarnings } from "../../../modules/canvas/droppedFields";
import { getBlocks } from "../../../modules/canvas/repository";
import { saveCanvas } from "../../../modules/canvas/service";
import type { CanvasChanges } from "../../../modules/canvas/types";
import { compilerGraph } from "../../../modules/compiler/service";
import { insertSandbox } from "../sandboxes/repository";
import { seedDefaultBlocks } from "../workflows/repository";
import type { RunBody } from "./dto";

const STRUCTURAL = new Set<string>([BlockTypes.entrypoint, BlockTypes.errorHandler]);

/** Thrown to roll the scratch canvas back; never leaves `buildEphemeralGraph`. */
const ROLLBACK = new Error("ephemeral canvas rolled back");

/** The handle an edge leaves a block on: the one given, or the block's only (or `source`) one. */
function handleFor(ref: string, type: string, given?: string, spec?: HandleSpec) {
	const handles = getOutputHandles(type, spec);
	const list = handles.join(", ") || "none: it ends the flow";
	if (given) {
		if (!handles.includes(given))
			throw new BadRequestError(`${type} block ${ref} has no "${given}" handle. Use ${list}.`);
		return given;
	}
	if (handles.includes("source")) return "source";
	if (handles.length === 1) return handles[0]!;
	if (!handles.length)
		throw new BadRequestError(`${type} block ${ref} ends the flow: nothing can follow it.`);
	throw new BadRequestError(
		`${type} block ${ref} has several handles: pass handle as one of ${list}.`,
	);
}

/** Refs and the edges between them, as the rows a canvas save takes. */
function translate({ blocks, edges }: Pick<RunBody, "blocks" | "edges">) {
	const byRef = new Map(blocks.map((b) => [b.ref, b]));
	if (byRef.size !== blocks.length) throw new BadRequestError("Two blocks share a ref.");
	const structural = blocks.find((b) => STRUCTURAL.has(b.type));
	if (structural)
		throw new BadRequestError(
			`${structural.ref} is a ${structural.type} block: the entrypoint and error handler are added for you. Leave them out.`,
		);

	const rows = edges.map((edge, i) => {
		const [fromRef = "", dotted] = edge.from.split(".");
		if (edge.handle && dotted && edge.handle !== dotted)
			throw new BadRequestError(
				`edges[${i}]: "${edge.from}" names the ${dotted} handle but handle is ${edge.handle}.`,
			);
		const from = byRef.get(fromRef);
		const to = byRef.get(edge.to);
		for (const [ref, found] of [
			[fromRef, from],
			[edge.to, to],
		] as const)
			if (!found)
				throw new BadRequestError(
					`edges[${i}]: no block "${ref}". Refs: ${[...byRef.keys()].join(", ")}.`,
				);
		if (from === to) throw new BadRequestError(`edges[${i}]: a block cannot connect to itself.`);
		// no spec source on admin yet: plugin manifests arrive with P1 (#857)
		const handle = handleFor(fromRef, from!.type, edge.handle ?? dotted);
		return {
			id: generateID(),
			from: fromRef,
			to: edge.to,
			fromHandle: `${fromRef}-${handle}`,
			toHandle: `${edge.to}-target`,
		};
	});
	return rows;
}

/**
 * The graph an ephemeral run (#741) compiles, built by the very rules of a
 * canvas save: the blocks and edges are written to a scratch sandbox inside a
 * transaction that is always rolled back, so no row outlives this call.
 *
 * The entrypoint and error handler are the ones a new sandbox starts with. The
 * entrypoint goes to the first block nothing else points at: the default edge.
 * Rule errors refuse the run (400); warnings come back with the graph.
 */
export async function buildEphemeralGraph(
	projectId: string,
	userId: string,
	input: Pick<RunBody, "blocks" | "edges">,
) {
	const edges = translate(input);
	const incoming = new Set(edges.map((e) => e.to));
	// a sticky note never compiles, so it cannot be where the run starts
	const head = input.blocks.find((b) => !incoming.has(b.ref) && b.type !== BlockTypes.sticky_note);
	if (!head)
		throw new BadRequestError(
			"Nothing to start from: every block is the target of an edge, or there are no blocks.",
		);

	const readable = (message: string) =>
		edges.reduce((text, e) => text.replaceAll(e.id, `${e.from} → ${e.to}`), message);
	let graph: ReturnType<typeof compilerGraph> | undefined;
	let warnings: string[] = [];
	/** the two seeded blocks by id, as the caller can call them */
	const names: Record<string, string> = {};
	try {
		await db.transaction(async (tx) => {
			const id = await insertSandbox(
				{ projectId, userId, name: "ephemeral", settings: { tracingEnabled: false } },
				tx,
			);
			await seedDefaultBlocks(id, tx, "sandbox");
			const parent = { type: "sandbox" as const, id };
			const seeded = await getBlocks(parent, tx);
			const entry = seeded.find((b) => b.type === BlockTypes.entrypoint)!;
			for (const b of seeded) names[b.id] = b.key;

			const all = [
				...edges,
				{
					id: generateID(),
					from: entry.id,
					to: head.ref,
					fromHandle: `${entry.id}-source`,
					toHandle: `${head.ref}-target`,
				},
			];
			const position = { x: 0, y: 0 };
			const changes: CanvasChanges = {
				actionsToPerform: {
					blocks: input.blocks.map((b) => ({ id: b.ref, action: "upsert" as const })),
					edges: all.map((e) => ({ id: e.id, action: "upsert" as const })),
				},
				changes: {
					blocks: input.blocks.map((b) => ({ id: b.ref, type: b.type, data: b.data, position })),
					edges: all,
				},
			};
			// the same data check a canvas save runs first; it parses `data` in place
			rememberDroppedWarnings(changes, blockDataValidator(changes));
			const saved = await saveCanvas(parent, changes, [projectId], tx, false, { dryRun: true });

			// a block's rule messages name its key (`jsrunner_1`); the caller knows its ref
			const refOf = (message: string) =>
				Object.entries(saved.newKeys).reduce(
					(text, [ref, key]) => text.replace(new RegExp(`\\b${key}\\b`, "g"), ref),
					readable(message),
				);
			const errors = saved.issues.filter((i) => i.severity === "error");
			if (errors.length) throw new BadRequestError(errors.map((i) => refOf(i.message)).join(" "));
			warnings = saved.issues.map((i) => refOf(i.message));

			graph = compilerGraph(
				[...seeded, ...changes.changes.blocks.filter((b) => b.type !== BlockTypes.sticky_note)],
				all,
			);
			throw ROLLBACK;
		});
	} catch (error) {
		if (error !== ROLLBACK) {
			// a cycle is the caller's graph, not a clash with anyone else's work
			if (error instanceof ConflictError || error instanceof BadRequestError)
				throw new BadRequestError(readable(error.message));
			throw error;
		}
	}
	return { ...graph!, warnings, names };
}
