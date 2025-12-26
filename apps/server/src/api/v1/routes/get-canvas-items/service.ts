import { z } from "zod";
import { responseSchema, XYPosition } from "./dto";
import { db } from "../../../../db";
import { getBlocks, getEdges, routeExist } from "./repository";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { AuthACL } from "../../../../db/schema";

export default async function handleRequest(
  id: string,
  acl: AuthACL[] = []
): Promise<z.infer<typeof responseSchema>> {
  const result = await db.transaction(async (tx) => {
    const routeExists = await routeExist(
      id,
      acl.map((a) => a.projectId),
      tx
    );
    if (!routeExists) throw new NotFoundError("Route not found");

    const blocks = await getBlocks(id, tx);
    const edges = await getEdges(id, tx);
    return {
      blocks: blocks.map((x) => ({
        id: x.id,
        type: x.type!,
        data: x.data! as any,
        position: x.position! as XYPosition,
      })),
      edges: edges.map((x) => ({
        id: x.id,
        from: x.from!,
        to: x.to!,
        fromHandle: x.fromHandle!,
        toHandle: x.toHandle!,
      })),
    };
  });
  if (!result) throw new ServerError("Something went wrong");
  return result;
}
