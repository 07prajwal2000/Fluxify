import z from "zod";
import { BaseBlock, BlockOutput, baseBlockDataSchema } from "../baseBlock";

export const stickyNotesSchema = z
  .object({
    notes: z.string(),
    color: z.enum(["red", "blue", "green", "yellow"]).default("yellow"),
    size: z.object({
      width: z.number().min(75).max(200).default(100),
      height: z.number().min(75).max(200).default(100),
    }),
  })
  .extend(baseBlockDataSchema.shape);

export const stickyNoteBlockAiDescription = {
  name: "sticky_note",
  description:
    "Adds an annotation or note to the canvas. Does not affect execution flow.",
  jsonSchema: JSON.stringify(z.toJSONSchema(stickyNotesSchema)),
};

export class stickyNoteBlock extends BaseBlock {
  public override async executeAsync(): Promise<BlockOutput> {
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
    };
  }
}
