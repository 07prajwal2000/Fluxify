import z from "zod";
import { BlockTypes } from "./blockTypes";
import { BaseBlock } from "./baseBlock";

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

export type EdgesType = Record<
  string,
  [
    {
      to: string;
      handle: string;
    },
  ]
>;

export interface BlockBuilderInterface {
  getEdges(): EdgesType;
  buildGraph(entrypoint: string): { [id: string]: BaseBlock };
  getEntrypoint(): string;
  getErrorHandlerId(): string;
}

export interface EngineFactory {
  create(builder: any, executor: string): any;
}

export interface IntegrationFactory {
  create(options: { integrationId: string; type: string }): any;
}
