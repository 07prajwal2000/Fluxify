import { getCache, deleteCacheKey } from "../../db/redis";

export async function revokeSessions(userId: string) {
  const sessions = JSON.parse(await getCache(`active-sessions-${userId}`)) as {
    token: string;
  }[];
  for (const session of sessions) {
    await deleteCacheKey(session.token);
  }
}
