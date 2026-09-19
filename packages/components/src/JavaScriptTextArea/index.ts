export { buildCanvasVariableTypeLib, useCanvasVariableTypes } from "./canvasVariableTypes";
export { FLUXIFY_JS_GLOBALS } from "./globals";
export { buildInputDataTypeLib, useInputDataTypes } from "./inputDataTypes";
export type { JavaScriptTextAreaProps } from "./JavaScriptTextArea";
export { JavaScriptTextArea } from "./lazy";
export {
	buildParamsTypeLib,
	type CustomBlockParamDef,
	useCustomBlockParamsTypes,
} from "./paramsTypes";
export { buildRouteParamTypeLib, useRouteParamTypes } from "./routeParamTypes";
export async function restartLanguageServer(): Promise<void> {
	const setup = await import("./setup");
	return setup.restartLanguageServer();
}
