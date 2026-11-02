import { parseSync } from "oxc-parser";
import { walk } from "./unawaited";

// ponytail: early feedback for honest authors, not a security control. It sees only the
// definition's own file, so a helper taking `ctx`, an alias or a computed name gets past it.
// The runtime gate is what enforces the permission.

type Node = { type: string; start: number; [key: string]: any };

/** whether `node` spells `getConfig`, as a name or, when computed, as a string */
const isGetConfig = (node: Node, computed: boolean) =>
	computed
		? node.type === "Literal" && node.value === "getConfig"
		: node.type === "Identifier" && node.name === "getConfig";

/** Direct uses of `getConfig` in `source`, as 1-based lines: `x.getConfig`, `x["getConfig"]`, `{ getConfig }`. */
export function findGetConfig(file: string, source: string): number[] {
	const { program, errors } = parseSync(file, source);
	if (errors.length) return []; // the bundler reports a syntax error properly
	const found = new Set<number>();
	const lineOf = (offset: number) => source.slice(0, offset).split("\n").length;
	walk(program, [], (n) => {
		if (n.type === "MemberExpression" && isGetConfig(n.property, n.computed))
			found.add(lineOf(n.property.start));
		if (n.type === "ObjectPattern")
			for (const p of n.properties)
				if (p.type === "Property" && isGetConfig(p.key, p.computed)) found.add(lineOf(p.key.start));
	});
	return [...found].sort((a, b) => a - b);
}
