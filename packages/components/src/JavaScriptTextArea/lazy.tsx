import { lazy, Suspense } from "react";
import type { JavaScriptTextAreaProps } from "./JavaScriptTextArea";

/**
 * Monaco is ~2MB and touches `window` at import time. Loading it lazily keeps it
 * out of the initial bundle — and out of every module that merely imports
 * something else from this package's barrel.
 */
const Editor = lazy(async () => ({
	default: (await import("./JavaScriptTextArea")).JavaScriptTextArea,
}));

export function JavaScriptTextArea(props: JavaScriptTextAreaProps) {
	return (
		<Suspense fallback={<div className={props.className} />}>
			<Editor {...props} />
		</Suspense>
	);
}
