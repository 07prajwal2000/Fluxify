import type { AdminApi } from "./adminApi";

type Hook = { blockId: string };
const BASE = { route: "/v1/routes", workflow: "/v1/workflows" };

/**
 * A suite's hooks name blocks of its target's canvas by id. The agent names
 * them by key, like everywhere else, so keys are swapped for ids on the way in
 * and back on the way out. An id still works on the way in.
 */
async function keysOf(get: AdminApi["get"], kind: keyof typeof BASE, targetId: string) {
	const canvas = await get(`${BASE[kind]}/${targetId}/canvas-items`);
	return canvas.blocks as { id: string; key: string }[];
}

export async function hooksWithIds<T extends Hook>(
	get: AdminApi["get"],
	kind: keyof typeof BASE,
	targetId: string,
	hooks: T[],
) {
	if (!hooks.length) return hooks;
	const idOf = new Map((await keysOf(get, kind, targetId)).map((b) => [b.key, b.id]));
	return hooks.map((h) => ({ ...h, blockId: idOf.get(h.blockId) ?? h.blockId }));
}

/** The suite as the server has it, with each hook's blockId shown as the block's key. */
export async function suiteWithKeys<
	S extends { routeId: string | null; workflowId: string | null; hooks?: Hook[] },
>(get: AdminApi["get"], suite: S) {
	if (!suite.hooks?.length) return suite;
	const [kind, id] = suite.routeId
		? (["route", suite.routeId] as const)
		: (["workflow", suite.workflowId!] as const);
	const keyOf = new Map((await keysOf(get, kind, id)).map((b) => [b.id, b.key]));
	return {
		...suite,
		hooks: suite.hooks.map((h) => ({ ...h, blockId: keyOf.get(h.blockId) ?? h.blockId })),
	};
}
