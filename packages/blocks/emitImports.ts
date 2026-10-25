import { importTarget, type ProjectDependencies } from "./packageImports";

/**
 * Imports resolve once per compiled artifact — at instantiation, i.e. on
 * compile and on hot reload — into bindings the block functions close over.
 * The loads start the moment the factory runs, so they are normally settled
 * before the first request; after that `$importsReady` is a plain boolean and
 * a request pays nothing at all, not even a microtask.
 *
 * `import(...)` is emitted directly rather than through a `lib` helper: an
 * artifact outlives the runtime that compiled it, and a worker mid-rollout
 * would hand this source an older `lib` with no such helper on it.
 *
 * `importsBySpec`: spec -> local name -> property read off the namespace (null = namespace).
 * `importOwners`: local name -> the spec that bound it.
 */
export function emitImports(
	importsBySpec: Map<string, Map<string, string | null>>,
	importOwners: Map<string, string>,
	dependencies?: ProjectDependencies,
) {
	// side-effect-only imports bind nothing but still have to be loaded
	if (!importsBySpec.size) return { declarations: "", ready: "", scopeSkip: "" };
	const names = [...importOwners.keys()];
	const loads = [...importsBySpec].map(([spec, bound], index) => {
		const namespace = `$mod_${index}`;
		const lines = [`const ${namespace} = await import(${importTarget(spec, dependencies)});`];
		const destructured: string[] = [];
		for (const [local, imported] of bound) {
			if (imported === null) lines.push(`${local} = ${namespace};`);
			// default interop: a CJS module has no `default`, it is the export
			else if (imported === "default")
				lines.push(`${local} = ${namespace}.default ?? ${namespace};`);
			else destructured.push(local === imported ? local : `${imported}: ${local}`);
		}
		if (destructured.length) {
			lines.push(`({ ${destructured.join(", ")} } = ${namespace});`);
		}
		return lines.join("\n");
	});
	return {
		declarations: [
			names.length ? `let ${names.join(", ")};` : "",
			names.length ? `const $importNames = new Set(${JSON.stringify(names)});` : "",
			"let $importsReady = false;",
			`const $imports = (async () => {\n${loads.join("\n")}\n})().then(() => { $importsReady = true; });`,
			// keeps a bad specifier from surfacing as an unhandled rejection; the
			// await below still rejects, so the failure reaches the request
			"$imports.catch(() => {});",
		]
			.filter(Boolean)
			.join("\n"),
		// settled by the time traffic arrives in every normal case, and then this
		// is a boolean test — no await, no microtask on the hot path
		ready: "if (!$importsReady) await $imports;",
		scopeSkip: names.length ? ", $importNames" : "",
	};
}
