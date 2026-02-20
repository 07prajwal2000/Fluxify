import { BaseBlock, Context } from "./baseBlock";
import { BlockTypes } from "./blockTypes";
import {
  BlockDTOType,
  BlocksListDTOSchemaType,
  EdgeDTOSchemaType,
  EdgesType,
  EngineFactory,
  IntegrationFactory,
} from "./builderTypes";
import { BlockFactory } from "./blockFactory";

export { blockDTOSchema, blocksListDTOSchema, edgeDTOSchema } from "./builderTypes";
export type { BlockDTOType, BlocksListDTOSchemaType, EdgeDTOSchemaType };

export class BlockBuilder {
  private edgesMap: EdgesType = {};
  private blocksMap: { [id: string]: BlockDTOType } = {};
  private entrypoint = "";
  private errorHandlerId: string = "";
  private blockFactory: BlockFactory;

  constructor(
    private readonly context: Context,
    engineFactory: EngineFactory,
    integrationFactory: IntegrationFactory,
    shouldValidateBlockData?: boolean,
  ) {
    this.blockFactory = new BlockFactory(
      context,
      engineFactory,
      integrationFactory,
      shouldValidateBlockData,
    );
  }

  public loadEdges(edges: EdgeDTOSchemaType) {
    const edgesMap: EdgesType = {};
    for (const edge of edges) {
      let handle = edge.toHandle;
      if (handle.includes("-")) {
        handle = handle.substring(handle.lastIndexOf("-") + 1);
      }
      const outgoing = { to: edge.to, handle };
      if (edge.from in edgesMap) {
        edgesMap[edge.from].push(outgoing);
      } else {
        edgesMap[edge.from] = [outgoing];
      }
    }
    this.edgesMap = edgesMap;
  }

  public loadBlocks(blocks: BlocksListDTOSchemaType) {
    for (const block of blocks) {
      this.blocksMap[block.id] = block;
      if (block.type === BlockTypes.entrypoint) this.entrypoint = block.id;
      if (block.type === BlockTypes.errorHandler) this.errorHandlerId = block.id;
    }
  }

  public getEdges() {
    return this.edgesMap;
  }

  public buildGraph(entrypoint: string) {
    const newBlocksMap: { [id: string]: BaseBlock } = {};
    this.build(entrypoint, newBlocksMap);
    this.build(this.errorHandlerId, newBlocksMap);
    return newBlocksMap;
  }

  public getEntrypoint() {
    return this.entrypoint;
  }

  public getErrorHandlerId() {
    return this.errorHandlerId;
  }

  private build(id: string, newBlockMap: { [id: string]: BaseBlock }) {
    if (id in newBlockMap || !(id in this.blocksMap)) return;
    const block = this.blocksMap[id];
    const createdBlock = this.blockFactory.createBlock(block, this, this.edgesMap);
    if (createdBlock) {
      newBlockMap[id] = createdBlock;
    }
    if (!(id in this.edgesMap)) return;
    for (const edge of this.edgesMap[id]) {
      this.build(edge.to, newBlockMap);
    }
  }
}
