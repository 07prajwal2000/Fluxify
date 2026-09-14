export { JavaScriptTextArea } from "./lazy";
export type { JavaScriptTextAreaProps } from "./JavaScriptTextArea";
export { FLUXIFY_JS_GLOBALS } from "./globals";
export {
	buildParamsTypeLib,
	useCustomBlockParamsTypes,
	type CustomBlockParamDef,
} from "./paramsTypes";
export { buildInputDataTypeLib, useInputDataTypes } from "./inputDataTypes";
export { buildRouteParamTypeLib, useRouteParamTypes } from "./routeParamTypes";
export { buildCanvasVariableTypeLib, useCanvasVariableTypes } from "./canvasVariableTypes";
export async function restartLanguageServer(): Promise<void> {
	const setup = await import("./setup");
	return setup.restartLanguageServer();
}
