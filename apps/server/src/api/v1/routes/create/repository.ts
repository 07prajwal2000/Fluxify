import { createInsertSchema } from "drizzle-zod";
import z from "zod";
import {
  blocksEntity,
  HttpMethod,
  projectsEntity,
  routesEntity,
} from "../../../../db/schema";
import { db, DbTransactionType } from "../../../../db";
import { and, eq, or } from "drizzle-orm";
import { generateID } from "@fluxify/lib";

const insertSchema = createInsertSchema(routesEntity);

export async function createRoute(
  data: z.infer<typeof insertSchema>,
  tx?: DbTransactionType
) {
  const newRoute = await (tx ?? db)
    .insert(routesEntity)
    .values(data)
    .returning();
  return newRoute[0].id;
}

export async function createDependency(
  routeId: string,
  tx?: DbTransactionType
) {
  const id1 = generateID();
  const id2 = generateID();
  await (tx ?? db)?.insert(blocksEntity).values({
    routeId,
    type: "entrypoint",
    position: {
      x: 0,
      y: 0,
    },
    data: {},
    id: id1,
  });
  await (tx ?? db)?.insert(blocksEntity).values({
    id: id2,
    routeId,
    type: "response",
    position: {
      x: 0,
      y: 100,
    },
    data: {
      httpCode: "200",
    },
  });
}

export async function checkRouteExist(
  name: string,
  path: string,
  method: HttpMethod,
  tx?: DbTransactionType
) {
  const exist = await (tx ?? db)
    .select({ id: routesEntity.id })
    .from(routesEntity)
    .where(
      or(
        eq(routesEntity.name, name),
        and(eq(routesEntity.path, path), eq(routesEntity.method, method))
      )
    )
    .limit(1);
  return exist.length > 0;
}

export async function checkProjectExist(id: string, tx?: DbTransactionType) {
  const project = await (tx ?? db)
    .select({ id: projectsEntity.id })
    .from(projectsEntity)
    .where(eq(projectsEntity.id, id))
    .limit(1);
  return project.length > 0;
}
