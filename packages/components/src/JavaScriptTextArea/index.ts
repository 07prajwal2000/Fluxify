export { buildBlockInputTypeLib, useBlockInputType } from "./blockInputTypes";
export { buildCanvasVariableTypeLib, useCanvasVariableTypes } from "./canvasVariableTypes";
export { FLUXIFY_JS_GLOBALS } from "./globals";
export { buildInputDataTypeLib, useInputDataTypes } from "./inputDataTypes";
export type { JavaScriptTextAreaProps } from "./JavaScriptTextArea";
export { JavaScriptTextArea } from "./lazy";
export {
	type InstalledPackage,
	loadPackageTypes,
	useNpmPackageTypes,
	usePackageTypes,
} from "./npmPackageTypes";
export {
	buildParamsTypeLib,
	type CustomBlockParamDef,
	useCustomBlockParamsTypes,
} from "./paramsTypes";
export { buildRouteParamTypeLib, useRouteParamTypes } from "./routeParamTypes";
export { TESTSUITE_TYPE_LIB, useTestSuiteGlobalTypes } from "./testSuiteTypes";
export async function restartLanguageServer(): Promise<void> {
	const setup = await import("./setup");
	return setup.restartLanguageServer();
}

/** What a JS Runner script returns, as TypeScript source. Loads Monaco on first use. */
export async function inferScriptOutput(source: string, inputType: string): Promise<string> {
	const infer = await import("./inferScriptOutput");
	return infer.inferScriptOutput(source, inputType);
}
