import { JsVM } from "@fluxify/lib";
import type { BlockTypes } from "../../blockTypes";
import type { BlockDTOType } from "../../builderTypes";

export function createContext() {
	const vars: Record<string, any> = {};
	return {
		vm: new JsVM(vars),
		route: "/test",
		apiId: "api-1",
		projectId: "proj-1",
		vars,
		stopper: { timeoutEnd: 0, duration: 10000 },
	} as any;
}

export const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

export const edge = (from: string, to: string, toHandle = "source") => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle,
});

export function occurrences(source: string, value: string) {
	return source.split(value).length - 1;
}
