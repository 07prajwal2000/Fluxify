import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// monaco-editor's `exports` map is `"./*": "./esm/vs/*.js"` — the subpath is
// relative to `esm/vs`, so spelling that prefix out fails to resolve.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { FLUXIFY_JS_GLOBALS } from "./globals";
import { importSpecifiers } from "./npmPackageTypes";
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
			return label === "typescript" || label === "javascript" ? new tsWorker() : new editorWorker();
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
		// packages re-exported as default imports (zod's locales) need this
		esModuleInterop: true,
	});
	// Runs once at module load: `addExtraLib` accumulates, so a per-editor call
	// would stack a duplicate copy of the globals on every mount.
	registerTypeLib("fluxify-globals", FLUXIFY_JS_GLOBALS, "file:///fluxify-globals.d.ts");

	// Bun and npm package types load from jsDelivr (see npmPackageTypes.ts).

	// Package names inside `from "…"`, `import("…")` and `require("…")`: the TS
	// worker can't list the virtual node_modules, so it only completes names it
	// already resolved.
	monaco.languages.registerCompletionItemProvider("javascript", {
		triggerCharacters: ['"', "'", "/", "@"],
		provideCompletionItems(model, position) {
			const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
			const typed = before.match(
				/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)["']([^"']*)$/,
			)?.[1];
			if (typed === undefined) return { suggestions: [] };
			const range = new monaco.Range(
				position.lineNumber,
				position.column - typed.length,
				position.lineNumber,
				position.column,
			);
			return {
				suggestions: importSpecifiers().map((name) => ({
					label: name,
					kind: monaco.languages.CompletionItemKind.Module,
					insertText: name,
					detail: "npm package",
					range,
				})),
			};
		},
	});

	loader.config({ monaco });
}

/**
 * Forces a reload of the Monaco JavaScript language service and core runtime types.
 * Re-registers the Fluxify runtime globals.
 */
export async function restartLanguageServer(): Promise<void> {
	if (typeof window === "undefined") return;

	monaco.typescript.javascriptDefaults.setCompilerOptions({
		target: monaco.typescript.ScriptTarget.ES2020,
		lib: ["es2020"],
		allowNonTsExtensions: true,
		moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
		esModuleInterop: true,
	});

	registerTypeLib("fluxify-globals", FLUXIFY_JS_GLOBALS, "file:///fluxify-globals.d.ts");
}

declare global {
	interface Window {
		MonacoEnvironment?: monaco.Environment;
	}
}
