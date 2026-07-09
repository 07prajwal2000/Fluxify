import { db } from "../../../../db";
import { projectsEntity, routesEntity } from "../../../../db/schema";
import { eq, and } from "drizzle-orm";

export async function getProject(projectId: string) {
  const res = await db.select().from(projectsEntity).where(eq(projectsEntity.id, projectId)).limit(1);
  return res[0];
}

export async function getActiveRoutes(projectId: string) {
  return await db
    .select()
    .from(routesEntity)
    .where(and(eq(routesEntity.projectId, projectId), eq(routesEntity.active, true)));
}
