import { upsertProjectSettingKey, checkProjectExists } from "./repository";
import { deleteCacheKey } from "../../../../../../db/redis";
import {
  projectSettingsKeySchemaMap,
  ProjectSettingsKeyType,
} from "../keySchemaMap";
import { BadRequestError } from "../../../../../../errors/badRequestError";
import { NotFoundError } from "../../../../../../errors/notFoundError";

import { testConnectionFn } from "./connection";

export default async function handleRequest(
  projectId: string,
  payload: { key: string; value?: string },
) {
  const projectExists = await checkProjectExists(projectId);
  if (!projectExists) {
    throw new NotFoundError("Project not found");
  }

  const { key, value } = payload;
  const schemaMap = projectSettingsKeySchemaMap[key as ProjectSettingsKeyType];

  if (!schemaMap) {
    throw new BadRequestError("Invalid key");
  }

  let finalValue = value;
  if (finalValue === undefined || finalValue === null || finalValue === "") {
    finalValue = schemaMap.defaultValue;
  }

  const parsed = schemaMap.schema.safeParse(finalValue);
  if (!parsed.success && finalValue !== schemaMap.defaultValue) {
    throw new BadRequestError(`Invalid value for key ${key}`);
  }

  if (finalValue) {
    const connectionTest = await testConnectionFn(
      key as ProjectSettingsKeyType,
      finalValue,
    );
    if (!connectionTest.success) {
      throw new BadRequestError(connectionTest.message);
    }
  }

  await upsertProjectSettingKey(projectId, key, finalValue);

  const cacheKey = `PROJECT-SETTINGS-${projectId}`;
  await deleteCacheKey(cacheKey);

  return { message: "Setting saved successfully" };
}
