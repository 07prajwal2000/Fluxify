import { BaseBlock, Context } from "./baseBlock";
import { BlockTypes } from "./blockTypes";
import { BlockDTOType, EngineFactory, IntegrationFactory, EdgesType } from "./builderTypes";
import { IfBlock, ifBlockSchema } from "./builtin/if";
import { JsRunnerBlock, jsRunnerBlockSchema } from "./builtin/jsRunner";
import { ConsoleLoggerBlock } from "./builtin/log/console";
import { SetVarBlock, setVarSchema } from "./builtin/setVar";
import { TransformerBlock, transformerBlockSchema } from "./builtin/transformer";
import { ForEachLoopBlock, forEachLoopBlockSchema } from "./builtin/loops/foreach";
import { ForLoopBlock, forLoopBlockSchema } from "./builtin/loops/for";
import { GetVarBlock, getVarBlockSchema } from "./builtin/getVar";
import { ResponseBlock, responseBlockSchema } from "./builtin/response";
import { EntrypointBlock } from "./builtin/entrypoint";
import { ArrayOperationsBlock, arrayOperationsBlockSchema } from "./builtin/arrayOperations";
import { GetHttpHeaderBlock, getHttpHeaderBlockSchema } from "./builtin/http/getHttpHeader";
import { SetHttpHeaderBlock } from "./builtin/http/setHttpHeader";
import { GetHttpParamBlock, getHttpParamBlockSchema } from "./builtin/http/getHttpParam";
import { GetHttpCookieBlock, getHttpCookieBlockSchema } from "./builtin/http/getHttpCookie";
import { SetHttpCookieBlock, setHttpCookieBlockSchema } from "./builtin/http/setHttpCookie";
import { GetHttpRequestBodyBlock } from "./builtin/http/getHttpRequestBody";
import { HttpRequestBlock, httpRequestBlockSchema } from "./builtin/httpRequest";
import { ErrorHandlerBlock, errorHandlerBlockSchema } from "./builtin/errorHandler";
import { CloudLogsBlock, cloudLogsBlockSchema } from "./builtin/log/cloudLogs";
import { GetSingleDbBlock, getSingleDbBlockSchema } from "./builtin/db/getSingle";
import { GetAllDbBlock, getAllDbBlockSchema } from "./builtin/db/getAll";
import { InsertDbBlock, insertDbBlockSchema } from "./builtin/db/insert";
import { DeleteDbBlock, deleteDbBlockSchema } from "./builtin/db/delete";
import { InsertBulkDbBlock, insertBulkDbBlockSchema } from "./builtin/db/insertBulk";
import { UpdateDbBlock, updateDbBlockSchema } from "./builtin/db/update";
import { NativeDbBlock, nativeDbBlockSchema } from "./builtin/db/native";
import { TransactionBlock, transactionDbBlockSchema } from "./builtin/db/transaction";

export class BlockFactory {
  constructor(
    private readonly context: Context,
    private readonly engineFactory: EngineFactory,
    private readonly integrationFactory: IntegrationFactory,
    private readonly shouldValidateBlockData?: boolean,
  ) {}

  public createBlock(block: BlockDTOType, builder: any, edgesMap: EdgesType): BaseBlock | undefined {
    switch (block.type) {
      case BlockTypes.entrypoint: return new EntrypointBlock(this.context, block.data, this.findEdge(block, "source", edgesMap));
      case BlockTypes.if: return this.createIfBlock(block, edgesMap);
      case BlockTypes.forloop: return this.createForLoopBlock(block, builder, edgesMap);
      case BlockTypes.foreachloop: return this.createForEachLoopBlock(block, builder, edgesMap);
      case BlockTypes.transformer: return new TransformerBlock(this.context, this.validate(transformerBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.setvar: return new SetVarBlock(this.context, this.validate(setVarSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.getvar: return new GetVarBlock(this.context, this.validate(getVarBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.consolelog: return new ConsoleLoggerBlock(this.context, block.data, this.findEdge(block, "source", edgesMap));
      case BlockTypes.jsrunner: return new JsRunnerBlock(this.context, this.validate(jsRunnerBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.response: return new ResponseBlock(this.context, this.validate(responseBlockSchema, block.data));
      case BlockTypes.arrayops: return new ArrayOperationsBlock(this.context, this.validate(arrayOperationsBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.httpGetHeader: return new GetHttpHeaderBlock(this.context, this.validate(getHttpHeaderBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.httpSetHeader: return new SetHttpHeaderBlock(this.context, this.validate(getHttpHeaderBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.httpGetParam: return new GetHttpParamBlock(this.context, this.validate(getHttpParamBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.httpGetCookie: return new GetHttpCookieBlock(this.context, this.validate(getHttpCookieBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.httpSetCookie: return new SetHttpCookieBlock(this.context, this.validate(setHttpCookieBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.httpGetRequestBody: return new GetHttpRequestBodyBlock(this.context, null, this.findEdge(block, "source", edgesMap));
      case BlockTypes.httprequest: return new HttpRequestBlock(this.context, this.validate(httpRequestBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.db_getsingle: return new GetSingleDbBlock(this.context, this.getDbAdapter(block.data.connection), this.validate(getSingleDbBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.db_getall: return new GetAllDbBlock(this.context, this.getDbAdapter(block.data.connection), this.validate(getAllDbBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.db_insert: return new InsertDbBlock(this.context, this.getDbAdapter(block.data.connection), this.validate(insertDbBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.db_delete: return new DeleteDbBlock(this.context, this.getDbAdapter(block.data.connection), this.validate(deleteDbBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.db_insertbulk: return new InsertBulkDbBlock(this.context, this.getDbAdapter(block.data.connection), this.validate(insertBulkDbBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.db_update: return new UpdateDbBlock(this.context, this.getDbAdapter(block.data.connection), this.validate(updateDbBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.db_native: return new NativeDbBlock(this.context, this.getDbAdapter(block.data.connection), this.validate(nativeDbBlockSchema, block.data), this.findEdge(block, "source", edgesMap));
      case BlockTypes.db_transaction: return this.createDbTransactionBlock(block, builder, edgesMap);
      case BlockTypes.errorHandler: return this.createErrorHandlerBlock(block, edgesMap);
      case BlockTypes.cloudLogs: return this.createCloudLogsBlock(block, edgesMap);
    }
  }

  private validate(schema: any, data: any) {
    if (!this.shouldValidateBlockData) return data;
    const res = schema.safeParse(data);
    if (!res.success) throw new Error("Invalid block data");
    return res.data;
  }

  private findEdge(block: BlockDTOType, handleType: string, edgesMap: EdgesType) {
    return edgesMap[block.id]?.find((edge) => edge.handle == handleType)?.to || "";
  }

  private getDbAdapter(connection: string) {
    return this.context.dbFactory!.getDbAdapter(connection);
  }

  private createIfBlock(block: BlockDTOType, edgesMap: EdgesType) {
    const data = this.validate(ifBlockSchema, block.data);
    return new IfBlock(this.findEdge(block, "success", edgesMap), this.findEdge(block, "failure", edgesMap), this.context, data);
  }

  private createForLoopBlock(block: BlockDTOType, builder: any, edgesMap: EdgesType) {
    const data = this.validate(forLoopBlockSchema, block.data);
    const executor = this.findEdge(block, "executor", edgesMap);
    return new ForLoopBlock(this.context, { ...data, block: executor }, this.engineFactory.create(builder, executor), this.findEdge(block, "source", edgesMap));
  }

  private createForEachLoopBlock(block: BlockDTOType, builder: any, edgesMap: EdgesType) {
    const data = this.validate(forEachLoopBlockSchema, block.data);
    const executor = this.findEdge(block, "executor", edgesMap);
    return new ForEachLoopBlock(this.context, { ...data, block: executor }, this.engineFactory.create(builder, executor), this.findEdge(block, "source", edgesMap));
  }

  private createDbTransactionBlock(block: BlockDTOType, builder: any, edgesMap: EdgesType) {
    const data = this.validate(transactionDbBlockSchema, block.data);
    const executor = this.findEdge(block, "executor", edgesMap);
    data.executor = executor;
    return new TransactionBlock(this.context, this.getDbAdapter(data.connection), data, this.engineFactory.create(builder, executor), this.findEdge(block, "source", edgesMap));
  }

  private createErrorHandlerBlock(block: BlockDTOType, edgesMap: EdgesType) {
    const data = this.validate(errorHandlerBlockSchema, block.data);
    const edge = this.findEdge(block, "source", edgesMap);
    if (edge === block.id) throw new Error("Error handler block cannot be connected to itself");
    return new ErrorHandlerBlock(edge, this.context, data);
  }

  private createCloudLogsBlock(block: BlockDTOType, edgesMap: EdgesType) {
    const data = this.validate(cloudLogsBlockSchema, block.data);
    const logger = this.integrationFactory.create({ integrationId: data.connection, type: "observability" });
    return new CloudLogsBlock(this.context, logger, data, this.findEdge(block, "source", edgesMap));
  }
}
