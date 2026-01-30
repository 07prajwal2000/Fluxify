import z from "zod";

export enum BlockTypes {
  entrypoint = "entrypoint",
  httprequest = "httprequest",
  if = "if",
  httpgetheader = "httpgetheader",
  httpsetheader = "httpsetheader",
  httpgetparam = "httpgetparam",
  httpgetcookie = "httpgetcookie",
  httpsetcookie = "httpsetcookie",
  httpgetrequestbody = "httpgetrequestbody",
  forloop = "forloop",
  foreachloop = "foreachloop",
  transformer = "transformer",
  setvar = "setvar",
  getvar = "getvar",
  consolelog = "consolelog",
  jsrunner = "jsrunner",
  response = "response",
  arrayops = "arrayops",
  db_getsingle = "db_getsingle",
  db_getall = "db_getall",
  db_delete = "db_delete",
  db_insert = "db_insert",
  db_insertbulk = "db_insertbulk",
  db_update = "db_update",
  db_native = "db_native",
  db_transaction = "db_transaction",
  stickynote = "sticky_note",
  errorHandler = "error_handler",
}

export enum BlockCategory {
  Core = "Core", // set/get var, array operations
  Flow = "Flow", // if, for loop, foreach loop
  Database = "Database",
  HTTP = "HTTP", // all req/res blocks, http request
  Logging = "Logging",
  Misc = "Misc", // js runner, transformer
}

export type BaseBlockType = {
  id: string;
  type: BlockTypes;
  position: {
    x: number;
    y: number;
  };
  data: any;
  selected?: boolean;
};

export type EdgeType = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
};

export const bulkInsertSchema = z.object({
  blocks: z.array(
    z.object({
      id: z.uuidv7(),
      position: z.object({
        x: z.number(),
        y: z.number(),
      }),
      type: z.enum(Object.values(BlockTypes)),
      data: z.any(),
    })
  ),
  edges: z.array(
    z.object({
      id: z.uuidv7(),
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string(),
      targetHandle: z.string(),
      type: z.literal("custom"),
    })
  ),
});

export const clipboardSchema = z.object({
  source: z.literal("FLUXIFY/COPY_PASTE"),
  data: bulkInsertSchema,
});
