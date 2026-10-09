import { withoutCustomBlockPrefix } from "@fluxify/lib/customBlockName";
import { BlockTypes } from "./blockTypes";

/**
 * A block's key is its readable name on a canvas: `<prefix>_<n>`, e.g.
 * `response_1`, `db_insert_2`, `custom_send_mail_1`. The server hands them out
 * when a block is created (see `reserveBlockKeys`); everything else reads them.
 */
const BUILT_IN = new Set<string>(Object.values(BlockTypes));

/**
 * `response` for the built-in response block, `custom_<name>` for a custom
 * block (its stored name minus the project namespace, so
 * `user_defined.project.send_mail` is `custom_send_mail`).
 */
export const blockKeyPrefix = (type: string) =>
	BUILT_IN.has(type)
		? type
		: `custom_${withoutCustomBlockPrefix(type).replace(/[^a-zA-Z0-9_]/g, "_")}`;

export const formatBlockKey = (prefix: string, n: number) => `${prefix}_${n}`;

/** The prefix of anything shaped like a key, or undefined when it is not one. */
export const blockKeyPrefixOf = (key: string) => /^(.+)_\d+$/.exec(key)?.[1];
