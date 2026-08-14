import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// monaco-editor's `exports` map is `"./*": "./esm/vs/*.js"` — the subpath is
// relative to `esm/vs`, so spelling that prefix out fails to resolve.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { FLUXIFY_JS_GLOBALS } from "./globals";
import { ensurePackageTypes } from "./loadPackageTypes";
import { registerTypeLib } from "./typeLibRegistry";

/**
 * Self-hosted Monaco. `@monaco-editor/react` otherwise fetches the whole editor
 * from a CDN at runtime, which breaks offline/air-gapped installs and puts a
 * third party on the critical path — so hand it the bundled copy instead.
 *
 * Importing this module is the whole setup; it must happen before any `Editor`
 * mounts, which the import in JavaScriptTextArea.tsx guarantees.
 */
if (typeof window !== "undefined") {
	window.MonacoEnvironment = {
		getWorker(_workerId, label) {
			// JavaScript is served by the TypeScript worker — that's what provides
			// the autocomplete and hover docs for the runtime globals.
			return label === "typescript" || label === "javascript"
				? new tsWorker()
				: new editorWorker();
		},
	};

	// Monaco 0.56 moved the TypeScript language service off `languages` and onto
	// its own top-level export. The old `monaco.languages.typescript.*` path —
	// which every pre-0.56 tutorial and the `Monaco` type still show — is
	// `undefined` here, so reaching for it throws.
	monaco.typescript.javascriptDefaults.setCompilerOptions({
		target: monaco.typescript.ScriptTarget.ES2020,
		lib: ["es2020"],
		allowNonTsExtensions: true,
		// NodeJs (not the default Classic) is what makes bare specifiers like
		// `import("zod")` look under a virtual `node_modules/`, which is where
		// the registered package types live.
		moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
		// zod's locale files are re-exported as default imports
		// (`export { default as ar } from "./ar.cjs"`) — without this they fail
		// to resolve (verified against real tsc; see sync-type-libs.ts).
		esModuleInterop: true,
	});
	// Runs once at module load: `addExtraLib` accumulates, so a per-editor call
	// would stack a duplicate copy of the globals on every mount.
	registerTypeLib("fluxify-globals", FLUXIFY_JS_GLOBALS, "file:///fluxify-globals.d.ts");

	// `libs.zod`/`libs._` reference the packages' real types (see globals.ts);
	// fetch and register them so those references resolve. Fire-and-forget —
	// completions for `libs.*` populate once the fetch lands.
	void ensurePackageTypes("zod");
	void ensurePackageTypes("underscore");
	// Bun's own runtime types — makes `import { file } from "bun"` and the
	// ambient `Bun` global resolve. Pulls in `@types/node` too (declared as
	// its dependency in sync-type-libs.ts).
	void ensurePackageTypes("bun");

	loader.config({ monaco });
}

declare global {
	interface Window {
		MonacoEnvironment?: monaco.Environment;
	}
}
