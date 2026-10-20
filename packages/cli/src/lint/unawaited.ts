import { parseSync } from "oxc-parser";

// ponytail: obvious cases only. Names are tracked per file, not per scope, and a
// promise kept in a variable counts as used if the variable is awaited, returned
// or passed on anywhere in the file. Real data flow needs a type checker.

type Node = { type: string; start: number; [key: string]: any };

function walk(node: unknown, ancestors: Node[], visit: (node: Node, ancestors: Node[]) => void) {
	if (Array.isArray(node)) {
		for (const n of node) walk(n, ancestors, visit);
		return;
	}
	if (!node || typeof (node as Node).type !== "string") return;
	visit(node as Node, ancestors);
	ancestors.push(node as Node);
	for (const [key, value] of Object.entries(node))
		if (key !== "type" && value && typeof value === "object") walk(value, ancestors, visit);
	ancestors.pop();
}

/** a `{ executeHandle }` or `{ executeHandle: run }` pattern: the local name it binds */
function boundName(prop: Node): string | undefined {
	if (prop.type !== "Property" || prop.computed || prop.key.name !== "executeHandle") return;
	const target = prop.value.type === "AssignmentPattern" ? prop.value.left : prop.value;
	return target.type === "Identifier" ? target.name : undefined;
}

const isCall = (n: Node, names: Set<string>) =>
	n.type === "CallExpression" &&
	((n.callee.type === "Identifier" && names.has(n.callee.name)) ||
		(n.callee.type === "MemberExpression" &&
			!n.callee.computed &&
			n.callee.property.name === "executeHandle"));

/** wrappers that pass a value through untouched */
const TRANSPARENT = new Set([
	"ParenthesizedExpression",
	"TSAsExpression",
	"TSNonNullExpression",
	"TSSatisfiesExpression",
	"ArrayExpression",
	"SpreadElement",
	"LogicalExpression",
	"SequenceExpression",
]);
/** a promise here is dropped or read as if it were its value */
const DROPPED = new Set([
	"ExpressionStatement",
	"BinaryExpression",
	"TemplateLiteral",
	"UnaryExpression",
]);

/**
 * Whether the promise `node` (the last in `chain`, its ancestors before it) is
 * awaited, returned or handed on. Unknown parents count as handled: a false
 * warning costs more than a missed one.
 */
function handled(node: Node, chain: Node[], used: (name: string) => boolean): boolean {
	for (let i = chain.length - 1; i >= 0; i--) {
		const parent = chain[i];
		const { type } = parent;
		if (TRANSPARENT.has(type)) {
			node = parent;
			continue;
		}
		if (type === "ConditionalExpression") {
			if (parent.test === node) return false;
			node = parent;
			continue;
		}
		if (type === "IfStatement") return parent.test !== node;
		if (type === "MemberExpression")
			return parent.object !== node || ["then", "catch", "finally"].includes(parent.property.name);
		if (type === "VariableDeclarator")
			return parent.id.type !== "Identifier" || used(parent.id.name);
		if (type === "AssignmentExpression")
			return parent.left.type !== "Identifier" || used(parent.left.name);
		return !DROPPED.has(type);
	}
	return true;
}

/** `executeHandle(...)` calls in `source` whose result is dropped, as 1-based lines */
export function findUnawaited(file: string, source: string): number[] {
	const { program, errors } = parseSync(file, source);
	if (errors.length) return []; // the bundler reports a syntax error properly

	const names = new Set<string>();
	walk(program, [], (n) => {
		if (n.type === "ObjectPattern")
			for (const p of n.properties) {
				const name = boundName(p);
				if (name) names.add(name);
			}
	});

	const calls: { node: Node; chain: Node[] }[] = [];
	const refs = new Map<string, { node: Node; chain: Node[] }[]>();
	walk(program, [], (n, chain) => {
		if (isCall(n, names)) calls.push({ node: n, chain: [...chain] });
		else if (n.type === "Identifier") {
			const list = refs.get(n.name) ?? [];
			refs.set(n.name, [...list, { node: n, chain: [...chain] }]);
		}
	});

	// names being resolved, so `a = b; b = a` ends
	const resolving = new Set<string>();
	const used = (name: string): boolean => {
		if (resolving.has(name)) return false;
		resolving.add(name);
		try {
			return (refs.get(name) ?? []).some(({ node, chain }) => {
				const parent = chain.at(-1)!;
				// the declaration, an assignment target or a property name is not a use
				if (parent.type === "VariableDeclarator" && parent.id === node) return false;
				if (parent.type === "AssignmentExpression" && parent.left === node) return false;
				if (parent.type === "Property" && parent.key === node && !parent.computed) return false;
				if (parent.type === "MemberExpression" && parent.property === node && !parent.computed)
					return false;
				return handled(node, chain, used);
			});
		} finally {
			resolving.delete(name);
		}
	};

	const lines = [...source.matchAll(/\n/g)].map((m) => m.index!);
	const lineOf = (offset: number) => lines.filter((l) => l < offset).length + 1;
	return calls
		.filter(({ node, chain }) => !handled(node, chain, used))
		.map(({ node }) => lineOf(node.start));
}
