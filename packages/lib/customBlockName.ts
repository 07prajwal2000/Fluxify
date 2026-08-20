/**
 * Project-scoped custom blocks are stored under a namespaced name: the create
 * endpoint prepends this, and the compiled worker's block library is keyed by
 * the stored name (`compiler/service.ts` → `registerLocally`). A canvas that
 * holds the bare name compiles to "No codegen for block type".
 *
 * Blocks with `sourceType` "inhouse" or "plugin" never go through that endpoint,
 * so their names are stored bare. Nothing may prefix a name unconditionally.
 */
export const CUSTOM_BLOCK_NAME_PREFIX = "user_defined.project.";

/** Idempotent: a name that already carries the prefix is returned unchanged. */
export function withCustomBlockPrefix(name: string): string {
	return name.startsWith(CUSTOM_BLOCK_NAME_PREFIX)
		? name
		: `${CUSTOM_BLOCK_NAME_PREFIX}${name}`;
}

export function withoutCustomBlockPrefix(name: string): string {
	return name.startsWith(CUSTOM_BLOCK_NAME_PREFIX)
		? name.slice(CUSTOM_BLOCK_NAME_PREFIX.length)
		: name;
}

/**
 * The name a reference to `name` should actually use, given the names that
 * exist (stored blocks plus anything the current run has proposed).
 *
 * Resolve-then-prefix rather than prefix-always: an inhouse block is stored
 * bare, so blind prefixing would break every reference to one. Only a name that
 * matches nothing falls back to the prefixed form — that is a block being
 * created right now, and the create endpoint will store it prefixed.
 */
/**
 * A free name for a block being created, given the names already taken.
 *
 * Two blocks cannot share a name: the create endpoint rejects a duplicate with
 * a conflict, and a canvas that references the name binds to whichever block
 * already holds it. Renaming has to happen before anything commits to the
 * string — once a sibling task has written `custom:<name>` into a canvas, the
 * two are bound to different blocks.
 *
 * Both forms count as taken. An inhouse block stored bare under `jwt_validate`
 * does not collide with `user_defined.project.jwt_validate` in the database,
 * but a reference to `jwt_validate` resolves to the inhouse one and the new
 * block is silently shadowed.
 */
export function uniqueCustomBlockName(
	name: string,
	taken: ReadonlySet<string>,
): string {
	const isTaken = (candidate: string) =>
		taken.has(candidate) || taken.has(withCustomBlockPrefix(candidate));
	if (!isTaken(name)) return name;
	// `taken` is finite, so this terminates; the suffix keeps snake_case.
	let suffix = 2;
	while (isTaken(`${name}_${suffix}`)) suffix++;
	return `${name}_${suffix}`;
}

export function resolveCustomBlockName(
	name: string,
	known: ReadonlySet<string>,
): string {
	for (const candidate of [
		name,
		withCustomBlockPrefix(name),
		withoutCustomBlockPrefix(name),
	]) {
		if (known.has(candidate)) return candidate;
	}
	return withCustomBlockPrefix(name);
}
