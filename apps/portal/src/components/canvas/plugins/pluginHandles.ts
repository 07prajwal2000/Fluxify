import { type HandleSpec, isFanOutHandle } from "@fluxify/blocks/layout";
import type { BlockHandleProps } from "../blocks/handles/BlockHandle";

type Props = Omit<BlockHandleProps, "blockId">;

/**
 * The sockets a plugin block's spec declares, as props for `<BlockHandle>`.
 * Inputs sit left; outputs (`[]`, `[source]` or `[success, failure]`) are the
 * builtin kinds on the right, so they land where a builtin's do; body handles
 * borrow the executor's look and sit on their corner. A body handle takes one
 * edge unless it is `allowMultiple`, the same rule a builtin body handle has.
 */
export function pluginHandleProps(spec: HandleSpec): Props[] {
	const deprecated = (name: string) => spec.deprecated?.[name];
	return [
		...spec.in.map((name) => ({
			kind: "target" as const,
			name,
			label: name === "target" ? undefined : name,
			deprecated: deprecated(name),
		})),
		...spec.out.map((name) => ({ kind: name, name, deprecated: deprecated(name) })),
		...spec.body.map(({ name, corner }) => ({
			kind: "executor" as const,
			name,
			corner,
			label: name,
			maxConnections: isFanOutHandle(name, spec) ? null : 1,
			deprecated: deprecated(name),
		})),
	];
}
