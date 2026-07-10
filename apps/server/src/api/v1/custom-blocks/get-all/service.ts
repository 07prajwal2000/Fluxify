import z from "zod";
import { requestQuerySchema, responseSchema } from "./dto";
import { getCustomBlocks } from "./repository";

export default async function handleRequest(
  query: z.infer<typeof requestQuerySchema>
): Promise<z.infer<typeof responseSchema>> {
  const blocks = await getCustomBlocks(query.projectId);
  return blocks.map((block) => ({
    id: block.id,
    label: block.label,
    name: block.name,
    description: block.description,
    icon: block.icon,
    iconUrl: block.iconUrl,
    inputParams: block.inputParams,
    sourceType: block.sourceType,
    source: block.source,
  }));
}
