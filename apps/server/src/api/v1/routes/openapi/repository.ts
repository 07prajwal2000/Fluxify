import { db } from "../../../../db";
import {
  httpRouteConfigEntity,
  projectsEntity,
  routesEntity,
} from "../../../../db/schema";
import { eq, and } from "drizzle-orm";

export async function getProject(projectId: string) {
  const res = await db.select().from(projectsEntity).where(eq(projectsEntity.id, projectId)).limit(1);
  return res[0];
}

export async function getActiveRoutes(projectId: string) {
  const rows = await db
    .select({ route: routesEntity, routeConfig: httpRouteConfigEntity.routeConfig })
    .from(routesEntity)
    .leftJoin(
      httpRouteConfigEntity,
      eq(httpRouteConfigEntity.routeId, routesEntity.id),
    )
    .where(and(eq(routesEntity.projectId, projectId), eq(routesEntity.active, true)));
  return rows.map(({ route, routeConfig }) => ({ ...route, routeConfig }));
}
