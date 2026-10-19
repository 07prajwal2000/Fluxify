import { BlockTypes } from "./blockTypes";
import type { BlockDTOType } from "./builderTypes";
import { emitCustomBlock, hasCustomBlock } from "./builtin/customBlock";
import { type BlockMetas, emitModuleBlock } from "./builtin/moduleBlock";
import { emitWorkflowEnd } from "./builtin/response";
import type { EmitNode } from "./compiler";
import { emitters } from "./registry";

/**
 * Which emitter compiles `block`. Metadata first (a programmable block), then a
 * canvas custom block in the run library, then the builtins.
 */
export function emitterFor(
	block: BlockDTOType,
	{ metas, projectId, asWorkflow }: { metas: BlockMetas; projectId?: string; asWorkflow: boolean },
) {
	const meta = metas[block.type];
	if (meta) return (node: EmitNode) => emitModuleBlock(node, meta);
	// anything else not built in is a custom block, resolved from the
	// worker-global library it was compiled into rather than being inlined here
	if (projectId && hasCustomBlock(projectId, block.type)) return emitCustomBlock;
	if (asWorkflow && block.type === BlockTypes.response) return emitWorkflowEnd;
	return emitters[block.type as BlockTypes];
}
