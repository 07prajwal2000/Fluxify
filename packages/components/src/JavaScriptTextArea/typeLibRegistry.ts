import * as monaco from "monaco-editor";

/**
 * Central place to add/remove ambient `.d.ts` content from the JS language
 * service. `addExtraLib` returns a disposable but nothing previously called
 * `.dispose()` on it, so re-registering the same id (e.g. a lib that changed)
 * silently stacked duplicates. Every source — the static Fluxify globals, the
 * `libs.*` real package types, future core APIs, community packages — goes
 * through this so add/remove is uniform and never leaks.
 */
const registered = new Map<string, monaco.IDisposable>();

export function registerTypeLib(id: string, content: string, virtualPath: string): void {
	registered.get(id)?.dispose();
	registered.set(
		id,
		monaco.typescript.javascriptDefaults.addExtraLib(content, virtualPath),
	);
}

export function unregisterTypeLib(id: string): void {
	registered.get(id)?.dispose();
	registered.delete(id);
}

/** Registers several files (a multi-file package) as one disposable unit. */
export function registerTypeLibFiles(
	id: string,
	files: { virtualPath: string; content: string }[],
): void {
	unregisterTypeLib(id);
	const disposables = files.map((file) =>
		monaco.typescript.javascriptDefaults.addExtraLib(file.content, file.virtualPath),
	);
	registered.set(id, { dispose: () => disposables.forEach((d) => d.dispose()) });
}
