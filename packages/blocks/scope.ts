const scopes = new WeakMap<object, any>();

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
		has: (target, key: any) =>
			key !== "input" && key !== "params" && !skip?.has(key),
		get: (target, key: any) =>
			key === Symbol.unscopables
				? undefined
				: Object.hasOwn(target, key)
					? target[key]
					: (globalThis as any)[key],
		set: (target, key: any, value) => {
			target[key] = value;
			return true;
		},
	});
}
