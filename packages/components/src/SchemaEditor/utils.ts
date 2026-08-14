import type {
	Rule,
	SchemaNode,
	SchemaPath,
	SchemaProperty,
	ValidationSchema,
} from "./types";

export const newPropertyId = () => Math.random().toString(36).slice(2, 9);

export const newProperty = (): SchemaProperty => ({
	id: newPropertyId(),
	key: "",
	dataType: "str",
	rules: [],
	// Explicit, and it matches the legacy editor. The parser treats a missing
	// `required` as required, so writing `false` is the only way to say optional.
	required: false,
});

const DEFAULT_ITEMS: SchemaProperty = { key: "", dataType: "str", rules: [] };

/**
 * Keys used more than once among siblings. An object key is unique by
 * definition, so a duplicate silently drops a field at compile time. Blanks are
 * ignored — a new row starts empty and is not yet a conflict.
 */
export function findDuplicateKeys(
	properties: readonly SchemaProperty[] = [],
): Set<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const property of properties) {
		const key = property.key.trim();
		if (!key) continue;
		if (seen.has(key)) duplicates.add(key);
		seen.add(key);
	}
	return duplicates;
}

/** The node at `path`, or `undefined` if the path runs off the tree. */
export function getAtPath(
	root: SchemaNode,
	path: SchemaPath,
): SchemaNode | undefined {
	let node: SchemaNode | undefined = root;
	for (const segment of path) {
		if (!node) return undefined;
		node =
			segment === "items" ? node.items : node.properties?.[segment];
	}
	return node;
}

/**
 * Returns a copy of `root` with `updater` applied at `path`. Only the nodes
 * along the path are cloned, so untouched subtrees keep their identity and
 * `React.memo` further down still holds.
 */
export function updateAtPath<T extends SchemaNode>(
	root: T,
	path: SchemaPath,
	updater: (node: SchemaNode) => SchemaNode,
): T {
	if (path.length === 0) return updater(root) as T;

	const [segment, ...rest] = path;
	if (segment === "items") {
		return {
			...root,
			items: updateAtPath(root.items ?? DEFAULT_ITEMS, rest, updater),
		};
	}

	const properties = [...(root.properties ?? [])];
	const child = properties[segment as number];
	if (!child) return root;
	properties[segment as number] = updateAtPath(child, rest, updater);
	return { ...root, properties };
}

/** Shallow-merges `updates` into the node at `path`. */
export function mergeAtPath<T extends SchemaNode>(
	root: T,
	path: SchemaPath,
	updates: Partial<SchemaProperty>,
): T {
	return updateAtPath(root, path, (node) => ({ ...node, ...updates }));
}

export function addPropertyAtPath<T extends SchemaNode>(
	root: T,
	path: SchemaPath,
): T {
	return updateAtPath(root, path, (node) => ({
		...node,
		properties: [...(node.properties ?? []), newProperty()],
	}));
}

export function removeAtPath<T extends SchemaNode>(root: T, path: SchemaPath): T {
	if (path.length === 0) return root;
	const last = path[path.length - 1]!;
	return updateAtPath(root, path.slice(0, -1), (parent) => {
		if (last === "items") {
			const { items: _dropped, ...rest } = parent;
			return rest;
		}
		return {
			...parent,
			properties: (parent.properties ?? []).filter((_, i) => i !== last),
		};
	});
}

// ── Rules ────────────────────────────────────────────────────────────────────

export function getRuleValue<T = unknown>(
	rules: Rule[] | undefined,
	type: string,
	defaultValue: T,
): T {
	const rule = rules?.find((r) => r.type === type);
	return rule === undefined ? defaultValue : (rule.value as T);
}

/**
 * Upserts a rule. An empty value removes the rule rather than persisting a
 * blank one — `0` and `false` are real values and survive.
 */
export function updateRule(
	rules: Rule[] | undefined,
	type: string,
	value: unknown,
): Rule[] {
	const next = rules ? [...rules] : [];
	const index = next.findIndex((r) => r.type === type);
	const isEmpty =
		value === "" ||
		value === undefined ||
		value === null ||
		(typeof value === "number" && Number.isNaN(value));

	if (isEmpty) {
		if (index >= 0) next.splice(index, 1);
		return next;
	}
	if (index >= 0) next[index] = { ...next[index], type, value };
	else next.push({ type, value });
	return next;
}

// ── Paths ────────────────────────────────────────────────────────────────────

/**
 * Dotted path used to look a field up in `typeOverrides`: `user.address.zip`,
 * `tags[]` for an array's items.
 */
export function pathToKeyString(root: SchemaNode, path: SchemaPath): string {
	let node: SchemaNode | undefined = root;
	let out = "";
	for (const segment of path) {
		if (!node) break;
		if (segment === "items") {
			out += "[]";
			node = node.items;
		} else {
			const child = node.properties?.[segment];
			out += out ? `.${child?.key ?? ""}` : (child?.key ?? "");
			node = child;
		}
	}
	return out;
}

export interface Breadcrumb {
	title: string;
	/** Path length to truncate to when this crumb is clicked. */
	level: number;
}

export function buildBreadcrumbs(
	root: SchemaNode,
	path: SchemaPath,
	rootTitle = "Main Schema",
): Breadcrumb[] {
	const crumbs: Breadcrumb[] = [{ title: rootTitle, level: 0 }];
	let node: SchemaNode | undefined = root;
	for (let i = 0; i < path.length; i++) {
		const segment = path[i]!;
		if (segment === "items") {
			crumbs.push({ title: "Array Items [ ]", level: i + 1 });
			node = node?.items;
		} else {
			const child = node?.properties?.[segment];
			if (!child) break;
			crumbs.push({
				title: child.key || `Property ${segment}`,
				level: i + 1,
			});
			node = child;
		}
	}
	return crumbs;
}

/** How many container levels deep `path` sits. */
export const depthOf = (path: SchemaPath) => path.length;

export const isEmptySchema = (schema: ValidationSchema) =>
	!schema.properties?.length && !schema.items && !schema.js;
