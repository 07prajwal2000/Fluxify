import { getProjectSettingsKeys, checkProjectExists } from "./repository";
import { getCache, setCache } from "../../../../../../db/redis";
import { NotFoundError } from "../../../../../../errors/notFoundError";

export default async function handleRequest(projectId: string) {
  const projectExists = await checkProjectExists(projectId);
  if (!projectExists) {
    throw new NotFoundError("Project not found");
  }

  const cacheKey = `PROJECT-SETTINGS-${projectId}`;
  const cachedSettings = await getCache(cacheKey);

  if (cachedSettings) {
    try {
      return JSON.parse(cachedSettings);
    } catch (e) {
      // ignore parse error and re-fetch
    }
  }

  const settings = await getProjectSettingsKeys(projectId);

  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }

  await setCache(cacheKey, JSON.stringify(result));
  return result;
}
