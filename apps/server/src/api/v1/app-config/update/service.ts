import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import { db } from "../../../../db";
import {
  getConfigById,
  getConfigByKeyName,
  updateAppConfig,
} from "./repository";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ConflictError } from "../../../../errors/conflictError";
import { EncryptionService } from "../../../../lib/encryption";
import { ServerError } from "../../../../errors/serverError";
import { BadRequestError } from "../../../../errors/badRequestError";
import { CHAN_ON_APPCONFIG_CHANGE, publishMessage } from "../../../../db/redis";

export default async function handleRequest(
  id: number,
  body: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
  if (!id || isNaN(id)) {
    throw new BadRequestError("Invalid id");
  }
  const result = await db.transaction(async (tx) => {
    const config = await getConfigById(id, tx);
    if (!config) {
      throw new NotFoundError("App config not found");
    }
    if (config.isEncrypted && !body.isEncrypted) {
      throw new BadRequestError("Cannot decrypt value once it is encrypted");
    }
    const keyNameExists = await getConfigByKeyName(body.keyName, tx);
    if (keyNameExists?.id && keyNameExists.id !== id) {
      throw new ConflictError("Key name already exists");
    }
    if ((config.isEncrypted || body.isEncrypted) && body.value !== undefined) {
      body.value = EncryptionService.encrypt(body.value.toString());
      body.value = EncryptionService.encodeData(body.value, body.encodingType);
    } else if (
      config.encodingType !== body.encodingType &&
      body.value === undefined
    ) {
      const oldValue = EncryptionService.decodeData(
        config.value!,
        config.encodingType!,
      );
      body.value = EncryptionService.encodeData(oldValue, body.encodingType);
    } else if (body.value !== undefined) {
      body.value = EncryptionService.encodeData(
        body.value.toString(),
        body.encodingType,
      );
    }
    const cfg = { ...body, value: body.value?.toString() };
    const updatedConfig = await updateAppConfig(id, cfg, tx);
    return updatedConfig;
  });
  if (!result) {
    throw new ServerError("Failed to update app config");
  }
  await publishMessage(CHAN_ON_APPCONFIG_CHANGE, "");
  return {
    id: result.id,
    keyName: result.keyName!,
    description: result.description!,
    value: result.isEncrypted
      ? EncryptionService.maskValue(result.value!).slice(0, 20)
      : result.value!,
    isEncrypted: result.isEncrypted!,
    encodingType: result.encodingType!,
    createdAt: result.createdAt!.toISOString(),
    updatedAt: result.updatedAt!.toISOString(),
  };
}
