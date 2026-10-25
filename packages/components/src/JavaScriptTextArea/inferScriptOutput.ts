/**
 * Works out what a JS Runner script returns, so the next block can type `input`.
 *
 * The script runs as the body of an async function, so it is wrapped as one in
 * a hidden model and the TypeScript worker emits the declaration for it. A
 * declaration, unlike hover text, is never truncated. The wrapper's `input`
 * parameter shadows the global one: each block is evaluated against its own
 * input, whichever block the panel has open.
 */

const FN = "__fluxifyRun";

/** One line: a JSDoc `@param` type cannot span lines. */
const oneLine = (type: string) => type.replace(/\s+/g, " ").trim();

export function wrapScript(source: string, inputType: string): string {
	return `/** @param {${oneLine(inputType) || "any"}} input */\nasync function ${FN}(input) {\n${source}\n}\n`;
}

/**
 * The `T` of `declare function __fluxifyRun(input: …): Promise<T>;`, or `any`
 * when the emit is missing or has a shape we do not recognise.
 */
export function extractReturnType(declaration: string): string {
	const start = declaration.indexOf(`function ${FN}(`);
	if (start === -1) return "any";
	const match = declaration.slice(start).match(/\):\s*Promise<([\s\S]*)>;\s*$/m);
	const inner = match?.[1]?.trim();
	if (!inner) return "any";
	// a script with no `return` has nothing to hand on
	return inner === "void" ? "undefined" : inner;
}

let seq = 0;

/** Returns the script's return type as TypeScript source; `any` when it cannot tell. */
export async function inferScriptOutput(source: string, inputType: string): Promise<string> {
	if (!source.trim()) return "undefined";
	const monaco = await import("monaco-editor");
	const uri = monaco.Uri.parse(`file:///fluxify-infer/${++seq}.js`);
	const model = monaco.editor.createModel(wrapScript(source, inputType), "javascript", uri);
	try {
		const getWorker = await monaco.typescript.getJavaScriptWorker();
		const worker = await getWorker(uri);
		const emitted = await worker.getEmitOutput(uri.toString(), true);
		return extractReturnType(emitted.outputFiles.map((file) => file.text).join("\n"));
	} catch {
		return "any";
	} finally {
		model.dispose();
	}
}
