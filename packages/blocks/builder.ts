import z from "zod";
import { BaseBlock, Context } from "./baseBlock";
import { BlockTypes } from "./blockTypes";
import { IfBlock, ifBlockSchema } from "./builtin/if";
import { JsRunnerBlock, jsRunnerBlockSchema } from "./builtin/jsRunner";
import { ConsoleLoggerBlock } from "./builtin/log/console";
import { SetVarBlock, setVarSchema } from "./builtin/setVar";
import {
  TransformerBlock,
  transformerBlockSchema,
} from "./builtin/transformer";
import {
  ForEachLoopBlock,
  forEachLoopBlockSchema,
} from "./builtin/loops/foreach";
import { Engine } from "./engine";
import { ForLoopBlock, forLoopBlockSchema } from "./builtin/loops/for";
import { GetVarBlock, getVarBlockSchema } from "./builtin/getVar";
import { ResponseBlock, responseBlockSchema } from "./builtin/response";
import { EntrypointBlock } from "./builtin/entrypoint";
import {
  ArrayOperationsBlock,
  arrayOperationsBlockSchema,
} from "./builtin/arrayOperations";
import {
  GetHttpHeaderBlock,
  getHttpHeaderBlockSchema,
} from "./builtin/http/getHttpHeader";
import { SetHttpHeaderBlock } from "./builtin/http/setHttpHeader";
import {
  GetHttpParamBlock,
  getHttpParamBlockSchema,
} from "./builtin/http/getHttpParam";
import {
  GetHttpCookieBlock,
  getHttpCookieBlockSchema,
} from "./builtin/http/getHttpCookie";
import {
  SetHttpCookieBlock,
  setHttpCookieBlockSchema,
} from "./builtin/http/setHttpCookie";
import { GetHttpRequestBodyBlock } from "./builtin/http/getHttpRequestBody";
import {
  GetSingleDbBlock,
  getSingleDbBlockSchema,
} from "./builtin/db/getSingle";
import { GetAllDbBlock, getAllDbBlockSchema } from "./builtin/db/getAll";
import { InsertDbBlock, insertDbBlockSchema } from "./builtin/db/insert";
import { DeleteDbBlock, deleteDbBlockSchema } from "./builtin/db/delete";
import {
  InsertBulkDbBlock,
  insertBulkDbBlockSchema,
} from "./builtin/db/insertBulk";
import { UpdateDbBlock, updateDbBlockSchema } from "./builtin/db/update";
import { NativeDbBlock, nativeDbBlockSchema } from "./builtin/db/native";
import {
  TransactionBlock,
  transactionDbBlockSchema,
} from "./builtin/db/transaction";
import {
  HttpRequestBlock,
  httpRequestBlockSchema,
} from "./builtin/httpRequest";

export const blockDTOSchema = z.object({
  id: z.uuidv7(),
  type: z.enum(BlockTypes),
  data: z.any(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const blocksListDTOSchema = z.array(blockDTOSchema);

export const edgeDTOSchema = z.array(
  z.object({
    id: z.uuidv7(),
    from: z.string(),
    to: z.string(),
    fromHandle: z.string(),
    toHandle: z.string(),
  }),
);
export type BlockDTOType = z.infer<typeof blockDTOSchema>;
export type BlocksListDTOSchemaType = z.infer<typeof blocksListDTOSchema>;
export type EdgeDTOSchemaType = z.infer<typeof edgeDTOSchema>;

type EdgesType = Record<
  string,
  [
    {
      to: string;
      handle: string;
    },
  ]
>;

export interface EngineFactory {
  create(builder: BlockBuilder, executor: string): Engine;
}

export class BlockBuilder {
  private edgesMap: EdgesType = {};
  private blocksMap: { [id: string]: BlockDTOType } = {};
  private entrypoint = "";
  constructor(
    private readonly context: Context,
    private readonly engineFactory: EngineFactory,
    private readonly shouldValidateBlockData?: boolean,
  ) {}

  // building graph's edges
  public loadEdges(edges: EdgeDTOSchemaType) {
    const edgesMap: EdgesType = {};
    for (const edge of edges) {
      let handle = edge.toHandle;
      const hasUuidInHandle = handle.lastIndexOf("-") !== -1;
      if (hasUuidInHandle) {
        handle = handle.substring(handle.lastIndexOf("-") + 1);
      }
      const outgoing = {
        to: edge.to,
        handle,
      };
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
      if (block.type == BlockTypes.entrypoint) {
        this.entrypoint = block.id;
      }
    }
  }
  public getEdges() {
    return this.edgesMap;
  }
  public buildGraph(entrypoint: string) {
    const newBlocksMap: { [id: string]: BaseBlock } = {};
    this.build(entrypoint, newBlocksMap);
    return newBlocksMap;
  }
  public getEntrypoint() {
    return this.entrypoint;
  }
  private build(id: string, newBlockMap: { [id: string]: BaseBlock }) {
    if (id in newBlockMap || !(id in this.blocksMap)) return;
    const block = this.blocksMap[id];
    newBlockMap[id] = this.createBlock(block)!;
    if (!(id in this.edgesMap)) return;
    for (const edge of this.edgesMap[id]) {
      this.build(edge.to, newBlockMap);
    }
  }
  private createBlock(block: BlockDTOType) {
    switch (block.type) {
      case BlockTypes.entrypoint:
        return this.createEntrypointBlock(block);
      case BlockTypes.if:
        return this.createIfBlock(block);
      case BlockTypes.forloop:
        return this.createForLoopBlock(block);
      case BlockTypes.foreachloop:
        return this.createForEachLoopBlock(block);
      case BlockTypes.transformer:
        return this.createTransformerBlock(block);
      case BlockTypes.setvar:
        return this.createSetVarBlock(block);
      case BlockTypes.getvar:
        return this.createGetVarBlock(block);
      case BlockTypes.consolelog:
        return this.createConsoleLogBlock(block);
      case BlockTypes.jsrunner:
        return this.createJsRunnerBlock(block);
      case BlockTypes.response:
        return this.createResponseBlock(block);
      case BlockTypes.arrayops:
        return this.createArrayOperationsBlock(block);
      case BlockTypes.httpGetHeader:
        return this.createHttpGetHeaderBlock(block);
      case BlockTypes.httpSetHeader:
        return this.createHttpSetHeaderBlock(block);
      case BlockTypes.httpGetParam:
        return this.createHttpGetParamBlock(block);
      case BlockTypes.httpGetCookie:
        return this.createHttpGetCookieBlock(block);
      case BlockTypes.httpSetCookie:
        return this.createHttpSetCookieBlock(block);
      case BlockTypes.httpGetRequestBody:
        return this.createHttpGetRequestBodyBlock(block);
      case BlockTypes.httprequest:
        return this.createHttpRequestBlock(block);

      case BlockTypes.db_getsingle:
        return this.createDbGetSingleBlock(block);
      case BlockTypes.db_getall:
        return this.createDbGetAllBlock(block);
      case BlockTypes.db_insert:
        return this.createDbInsertBlock(block);
      case BlockTypes.db_delete:
        return this.createDbDeleteBlock(block);
      case BlockTypes.db_insertbulk:
        return this.createDbInsertBulkBlock(block);
      case BlockTypes.db_update:
        return this.createDbUpdateBlock(block);
      case BlockTypes.db_native:
        return this.createDbNativeBlock(block);
      case BlockTypes.db_transaction:
        return this.createDbTransactionBlock(block);
    }
  }
  private createDbTransactionBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? transactionDbBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    const executor = this.findEdge(block, "executor");
    parsedResult.data.executor = executor;
    return new TransactionBlock(
      this.context,
      this.context.dbFactory!.getDbAdapter(parsedResult.data.connection),
      parsedResult.data,
      this.engineFactory.create(this, executor),
      edge,
    );
  }

  private createHttpRequestBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? httpRequestBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new HttpRequestBlock(this.context, parsedResult.data, edge);
  }

  private createDbGetSingleBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? getSingleDbBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new GetSingleDbBlock(
      this.context,
      this.context.dbFactory!.getDbAdapter(parsedResult.data.connection),
      parsedResult.data,
      edge,
    );
  }
  private createDbGetAllBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? getAllDbBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new GetAllDbBlock(
      this.context,
      this.context.dbFactory!.getDbAdapter(parsedResult.data.connection),
      parsedResult.data,
      edge,
    );
  }
  private createDbNativeBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? nativeDbBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new NativeDbBlock(
      this.context,
      this.context.dbFactory!.getDbAdapter(parsedResult.data.connection),
      parsedResult.data,
      edge,
    );
  }
  private createDbUpdateBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? updateDbBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new UpdateDbBlock(
      this.context,
      this.context.dbFactory!.getDbAdapter(parsedResult.data.connection),
      parsedResult.data,
      edge,
    );
  }
  private createDbInsertBulkBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? insertBulkDbBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new InsertBulkDbBlock(
      this.context,
      this.context.dbFactory!.getDbAdapter(parsedResult.data.connection),
      parsedResult.data,
      edge,
    );
  }
  private createDbDeleteBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? deleteDbBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new DeleteDbBlock(
      this.context,
      this.context.dbFactory!.getDbAdapter(parsedResult.data.connection),
      parsedResult.data,
      edge,
    );
  }
  private createDbInsertBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? insertDbBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new InsertDbBlock(
      this.context,
      this.context.dbFactory!.getDbAdapter(parsedResult.data.connection),
      parsedResult.data,
      edge,
    );
  }
  private createHttpGetHeaderBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? getHttpHeaderBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new GetHttpHeaderBlock(this.context, parsedResult.data, edge);
  }
  private createHttpSetHeaderBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? getHttpHeaderBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new SetHttpHeaderBlock(this.context, parsedResult.data, edge);
  }
  private createHttpGetParamBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? getHttpParamBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new GetHttpParamBlock(this.context, parsedResult.data, edge);
  }
  private createHttpGetCookieBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? getHttpCookieBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new GetHttpCookieBlock(this.context, parsedResult.data, edge);
  }
  private createHttpSetCookieBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? setHttpCookieBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new SetHttpCookieBlock(this.context, parsedResult.data, edge);
  }
  private createHttpGetRequestBodyBlock(block: BlockDTOType) {
    const edge = this.findEdge(block, "source");
    return new GetHttpRequestBodyBlock(this.context, null, edge);
  }
  private createArrayOperationsBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? arrayOperationsBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    const edge = this.findEdge(block, "source");
    return new ArrayOperationsBlock(this.context, parsedResult.data, edge);
  }
  private createIfBlock(block: BlockDTOType) {
    const parsedResult = this.shouldValidateBlockData
      ? ifBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    const successBlock = this.findEdge(block, "success");
    const failureBlock = this.findEdge(block, "failure");
    return new IfBlock(
      successBlock,
      failureBlock,
      this.context,
      parsedResult.data,
    );
  }
  private createJsRunnerBlock(block: BlockDTOType): BaseBlock {
    const parsedResult = this.shouldValidateBlockData
      ? jsRunnerBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    const edge = this.findEdge(block, "source");
    return new JsRunnerBlock(this.context, parsedResult.data, edge);
  }
  private createConsoleLogBlock(block: BlockDTOType): BaseBlock {
    const edge = this.findEdge(block, "source");
    return new ConsoleLoggerBlock(this.context, block.data, edge);
  }
  private createSetVarBlock(block: BlockDTOType): BaseBlock {
    const edge = this.findEdge(block, "source");
    const parsedResult = this.shouldValidateBlockData
      ? setVarSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid set var block data");
    return new SetVarBlock(this.context, parsedResult.data, edge);
  }
  private createTransformerBlock(block: BlockDTOType): BaseBlock {
    const edge = this.findEdge(block, "source");
    const parsedResult = this.shouldValidateBlockData
      ? transformerBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };

    return new TransformerBlock(this.context, parsedResult.data, edge);
  }
  private createForEachLoopBlock(block: BlockDTOType): BaseBlock {
    const edge = this.findEdge(block, "source");
    const executor = this.findEdge(block, "executor");
    const engine = this.engineFactory.create(this, executor);
    const parsedResult = this.shouldValidateBlockData
      ? forEachLoopBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success)
      throw new Error("Invalid for each loop block data");

    return new ForEachLoopBlock(
      this.context,
      {
        ...parsedResult.data,
        block: executor,
      },
      engine,
      edge,
    );
  }
  private createForLoopBlock(block: BlockDTOType): BaseBlock {
    const edge = this.findEdge(block, "source");
    const executor = this.findEdge(block, "executor");
    const engine = this.engineFactory.create(this, executor);
    const parsedResult = this.shouldValidateBlockData
      ? forLoopBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid for loop block data");
    return new ForLoopBlock(
      this.context,
      {
        ...parsedResult.data,
        block: executor,
      },
      engine,
      edge,
    );
  }
  private createResponseBlock(block: BlockDTOType): BaseBlock {
    const parsedResult = this.shouldValidateBlockData
      ? responseBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid response block data");
    return new ResponseBlock(this.context, parsedResult.data);
  }
  private createGetVarBlock(block: BlockDTOType): BaseBlock {
    const edge = this.findEdge(block, "source");
    const parsedResult = this.shouldValidateBlockData
      ? getVarBlockSchema.safeParse(block.data)
      : { data: block.data, success: true };
    if (!parsedResult.success) throw new Error("Invalid get var block data");
    return new GetVarBlock(this.context, parsedResult.data, edge);
  }
  private createEntrypointBlock(block: BlockDTOType): BaseBlock {
    const edge = this.findEdge(block, "source");
    return new EntrypointBlock(this.context, block.data, edge);
  }
  private findEdge(block: BlockDTOType, handleType: string) {
    const edge = this.edgesMap[block.id]?.find(
      (edge) => edge.handle == handleType,
    );
    return edge?.to || "";
  }
}
