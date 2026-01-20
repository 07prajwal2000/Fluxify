import { z } from "zod";
import { requestQuerySchema, responseSchema } from "./dto";
import { getAppConfigList } from "./repository";

export default async function handleRequest(
  params: z.infer<typeof requestQuerySchema>
): Promise<z.infer<typeof responseSchema>> {
  const { page, perPage, search, sort, sortBy } = params;

  const offset = perPage * (page - 1);

  const { result, totalCount } = await getAppConfigList(
    offset,
    perPage,
    search,
    sort,
    sortBy
  );
  const hasNext = offset + result.length < totalCount;

  const modifiedList = result.map((item) => ({
    id: item.id,
    keyName: item.keyName!,
    isEncrypted: item.isEncrypted!,
    encodingType: item.encodingType!,
    dataType: item.dataType!,
    createdAt: item.createdAt!.toISOString(),
    updatedAt: item.updatedAt!.toISOString(),
  }));
  return {
    data: modifiedList,
    pagination: {
      hasNext,
      page,
      totalPages: Math.ceil(totalCount / perPage),
    },
  };
}
