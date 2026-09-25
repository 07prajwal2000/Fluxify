import type { EditorProps } from "@monaco-editor/react";
import { lazy, Suspense } from "react";

/**
 * `@monaco-editor/react`'s Editor, loaded only after `./setup` has pointed its
 * loader at the bundled Monaco.
 *
 * The loader starts once, on the first editor that mounts. If that editor mounts
 * before `setup` ran, the loader fetches Monaco from the CDN, and every editor on
 * the page then runs on that copy — without the Fluxify globals, the npm package
 * types or any `typeDefinitions`, so nothing autocompletes. Every Monaco editor
 * outside JavaScriptTextArea mounts through this.
 */
const Editor = lazy(async () => {
	await import("./setup");
	return import("@monaco-editor/react");
});

export function MonacoEditor(props: EditorProps) {
	return (
		<Suspense fallback={<div style={{ height: props.height }} />}>
			<Editor {...props} />
		</Suspense>
	);
}
