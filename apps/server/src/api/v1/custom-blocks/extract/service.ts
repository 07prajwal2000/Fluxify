import { BlockTypes } from "@fluxify/blocks";
import { STARTER_POSITIONS } from "@fluxify/blocks/layout";
import { generateID, withCustomBlockPrefix } from "@fluxify/lib";
import type z from "zod";
import { db } from "../../../../db";
import { CHAN_ON_CUSTOM_BLOCK_CHANGE, publishMessage } from "../../../../db/redis";
import { NotFoundError } from "../../../../errors/notFoundError";
import { getBlocks, getEdges, parentExists } from "../../../../modules/canvas/repository";
import { CHANGE_CHANNEL, saveCanvas } from "../../../../modules/canvas/service";
import type { CanvasParent } from "../../../../modules/canvas/types";
import { assertOwnSandbox } from "../../triggers/sandboxes";
import createCustomBlock from "../create/service";
import type { requestBodySchema, responseSchema } from "./dto";
import { planExtraction } from "./plan";

/** where the first block sits to the right of the new canvas' entrypoint */
const GAP = 280;

/** a fan-out block lists its branches by block id; point the copy at the copies */
const remapOrder = (data: unknown, idOf: (old: string) => string | undefined) => {
	const d = data as { order?: unknown } | null;
	return Array.isArray(d?.order)
		? { ...d, order: d.order.flatMap((id: string) => idOf(id) ?? []) }
		: data;
};

const pos = (p: unknown) => p as { x: number; y: number };

/**
 * #753: the selected blocks become a custom block (one transaction, canvas
 * included), and with `replace` the selection on the source canvas becomes one
 * instance of it. The block's `input` is whatever the previous block hands in,
 * so there are no input parameters to infer.
 */
export default async function handleRequest(
	data: z.infer<typeof requestBodySchema>,
	userId: string,
): Promise<z.infer<typeof responseSchema>> {
	const source: CanvasParent = { type: data.source.kind, id: data.source.id };
	const name = withCustomBlockPrefix(data.name);
	let instanceKey: string | undefined;

	const created = await db.transaction(async (tx) => {
		if (source.type === "sandbox") await assertOwnSandbox(data.projectId, source.id, userId, tx);
		else if (!(await parentExists(source, [data.projectId], tx)))
			throw new NotFoundError(`${source.type.replace("_", " ")} not found`);

		const plan = planExtraction(await getBlocks(source, tx), await getEdges(source, tx), data.keys);
		const minX = Math.min(...plan.picked.map((b) => pos(b.position).x));
		const minY = Math.min(...plan.picked.map((b) => pos(b.position).y));

		const { id } = await createCustomBlock(
			{ projectId: data.projectId, name, label: data.label, usage: "flow" },
			tx,
			false,
		);

		// new ids, so the original blocks can stay (or go) independently
		const ids = new Map(plan.picked.map((b) => [b.id, generateID()]));
		const entry = generateID();
		const errorHandler = generateID();
		const lookup = (old: string | null) => ids.get(old ?? "");
		const idOf = (old: string | null) => lookup(old) as string;
		await saveCanvas(
			{ type: "custom_block", id },
			{
				actionsToPerform: { blocks: [], edges: [] },
				changes: {
					blocks: [
						{
							id: entry,
							type: BlockTypes.entrypoint,
							data: {},
							position: STARTER_POSITIONS.entrypoint,
						},
						{
							id: errorHandler,
							type: BlockTypes.errorHandler,
							data: {},
							position: STARTER_POSITIONS.errorHandler,
						},
						...plan.picked.map((b) => ({
							id: idOf(b.id),
							type: b.type as string,
							data: remapOrder(b.data, lookup),
							position: {
								x: pos(b.position).x - minX + GAP,
								y: pos(b.position).y - minY,
							},
						})),
					],
					edges: [
						{
							id: generateID(),
							from: entry,
							to: idOf(plan.head.id),
							fromHandle: `${entry}-source`,
							toHandle: `${idOf(plan.head.id)}-target`,
						},
						...plan.inner.map((e) => ({
							id: generateID(),
							from: idOf(e.from),
							to: idOf(e.to),
							fromHandle: e.fromHandle?.replace(e.from as string, idOf(e.from)) ?? null,
							toHandle: e.toHandle?.replace(e.to as string, idOf(e.to)) ?? null,
						})),
					],
				},
			},
			[data.projectId],
			tx,
		);

		if (data.replace) {
			const instance = generateID();
			const edgeIds = [...plan.inner, plan.incoming, plan.outgoing]
				.filter(Boolean)
				.map((e) => e.id);
			const { newKeys } = await saveCanvas(
				source,
				{
					actionsToPerform: {
						blocks: plan.picked.map((b) => ({ id: b.id, action: "delete" as const })),
						edges: edgeIds.map((id) => ({ id, action: "delete" as const })),
					},
					changes: {
						blocks: [
							{
								id: instance,
								type: name,
								data: { blockName: data.label },
								position: { x: minX, y: minY },
							},
						],
						edges: [
							...(plan.incoming
								? [
										{
											id: generateID(),
											from: plan.incoming.from as string,
											to: instance,
											fromHandle: plan.incoming.fromHandle,
											toHandle: `${instance}-target`,
										},
									]
								: []),
							...(plan.outgoing
								? [
										{
											id: generateID(),
											from: instance,
											to: plan.outgoing.to as string,
											fromHandle: `${instance}-source`,
											toHandle: plan.outgoing.toHandle,
										},
									]
								: []),
						],
					},
				},
				[data.projectId],
				tx,
			);
			instanceKey = newKeys[instance];
		}
		return id;
	});

	await publishMessage(CHAN_ON_CUSTOM_BLOCK_CHANGE, created);
	// saveCanvas leaves the change signal to the transaction owner
	if (data.replace) await publishMessage(CHANGE_CHANNEL[source.type], source.id);
	return { id: created, name, instanceKey };
}
