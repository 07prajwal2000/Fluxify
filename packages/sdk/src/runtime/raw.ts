import { isBuiltInVariant } from "../integrations/variants.js";

/** clients whose `raw` was recorded: a plugin variant's adapter, or a test fake */
const recorded = new WeakMap<object, () => unknown>();

/** Records what `connection(...).raw` is for `client`: what a plugin variant's `connect` returned. */
export function setRaw(client: unknown, raw: () => unknown) {
	if ((typeof client === "object" || typeof client === "function") && client)
		recorded.set(client, raw);
}

/**
 * `connection(...).raw` for the client `get` returned: what was recorded for
 * it; else, for a built-in variant, its own client through the group's
 * contract (`getConnection()` for kv and database, `client()` for a queue
 * producer), undefined in a group without one; else (a plugin's own group)
 * the client itself, which is what its `connect` returned.
 */
export async function rawOf(group: string, variant: string, client: unknown): Promise<unknown> {
	const own = (typeof client === "object" || typeof client === "function") && client;
	const raw = own ? recorded.get(own) : undefined;
	if (raw) return raw();
	if (!isBuiltInVariant(group, variant)) return client;
	const c = client as { getConnection?(): unknown; client?(): Promise<unknown> } | undefined;
	if (group === "kv" || group === "database") return c?.getConnection?.();
	if (group === "queue") return c?.client?.();
	return undefined;
}
