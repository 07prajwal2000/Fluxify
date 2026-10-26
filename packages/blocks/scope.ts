const scopes = new WeakMap<object, any>();

/**
 * Where a snippet's globals (`dbQuery`, `kv`) live while it runs, read before
 * vars. Adding and deleting names here keeps them off vars itself: a `delete`
 * there would leave every later read of vars on the slow path (#944).
 */
export const SNIPPET_GLOBALS = Symbol("fluxify.snippetGlobals");

/**
 * What lets inlined user code keep writing bare `abcd` instead of `vars.abcd`:
 * the sandbox handed user code its vars object as the global, so `with (scope)`
 * reproduces that. `has` claims every name so reads resolve here first, falling
 * back to globalThis for Math/JSON/Date; assignments always land in vars, which
 * is how blocks share state. `input` is excluded so it resolves to the wrapper
 * function's parameter instead of leaking into vars, and so are the graph's
 * hoisted import names, which resolve to the module bindings around the block
 * functions.
 */
export function scopeFor(vars: Record<string, any>, skip?: Set<string>) {
	// only the plain case is cached: the skip set belongs to one compiled graph,
	// and a custom block shares the caller's vars with a different set
	if (skip?.size) return makeScope(vars, skip);
	let scope = scopes.get(vars);
	if (!scope) {
		scope = makeScope(vars);
		scopes.set(vars, scope);
	}
	return scope;
}

function makeScope(vars: Record<string, any>, skip?: Set<string>) {
	return new Proxy(vars, {
		// `input` and `params` are function parameters of the emitted JS wrapper;
		// letting `with` resolve them off vars would shadow them with a variable
		// that merely shares the name.
		has: (target, key: any) => key !== "input" && key !== "params" && !skip?.has(key),
		get: (target, key: any) => {
			if (key === Symbol.unscopables) return undefined;
			const globals = (target as Record<symbol, any>)[SNIPPET_GLOBALS];
			if (globals !== undefined && Object.hasOwn(globals, key)) return globals[key];
			return Object.hasOwn(target, key) ? target[key] : (globalThis as any)[key];
		},
		set: (target, key: any, value) => {
			// a snippet assigning its own global changes it for that run only, as before
			const globals = (target as Record<symbol, any>)[SNIPPET_GLOBALS];
			if (globals !== undefined && Object.hasOwn(globals, key)) globals[key] = value;
			else target[key] = value;
			return true;
		},
	});
}
