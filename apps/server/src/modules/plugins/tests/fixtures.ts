import { BlockTypes } from "@fluxify/blocks";
import { blockEntryPath } from "@fluxify/sdk/blocks";

/** one manifest block, `[success, failure]` by default */
export const entry = (name: string, over: Record<string, unknown> = {}) => ({
	name,
	label: "Step",
	shape: "square",
	invoke: ["sync"],
	permissions: {},
	params: {},
	handles: { in: ["target"], out: ["success", "failure"], body: [] },
	deprecated: null,
	entry: blockEntryPath(name),
	...over,
});

/** a valid `fluxify.json` for `name`, with `blocks` (default: one `step` block) */
export const manifest = (name = "acme/echo", blocks = [entry(`${name}/step`)]) => ({
	name,
	url: "https://github.com/acme/fluxify-echo",
	sdk: ">=2026.10.0",
	blocks: Object.fromEntries(blocks.map((b) => [b.name, b])),
});

const node = (id: string, type: string, data: any = {}) => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string, handle = "source") => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: `${from}-${handle}`,
	toHandle: `${to}-target`,
});

/** entrypoint → `type` → response on success */
export const graphCalling = (type: string) => ({
	blocks: [
		node("1", BlockTypes.entrypoint),
		node("2", type),
		node("3", BlockTypes.response, { httpCode: "200" }),
	],
	edges: [edge("1", "2"), edge("2", "3", "success")],
});
