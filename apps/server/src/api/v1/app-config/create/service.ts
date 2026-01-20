import { z } from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import { db } from "../../../../db";
import { createAppConfig, keyExists } from "./repository";
import { ServerError } from "../../../../errors/serverError";
import { ConflictError } from "../../../../errors/conflictError";
import { EncryptionService } from "../../../../lib/encryption";
import { CHAN_ON_APPCONFIG_CHANGE, publishMessage } from "../../../../db/redis";
import { AppConfigDataTypes } from "../../../../db/schema";
import { BadRequestError } from "../../../../errors/badRequestError";

export default async function handleRequest(
  body: z.infer<typeof requestBodySchema>
): Promise<z.infer<typeof responseSchema>> {
  const name = body.keyName;
  const dataType = body.dataType;
  handleValidation(dataType, body.value);
  const result = await db.transaction(async (tx) => {
    const exist = await keyExists(name, tx);
    if (exist) {
      throw new ConflictError("Key already exists");
    }
    if (body.isEncrypted) {
      body.value = EncryptionService.encrypt(body.value);
    }
    body.value = EncryptionService.encodeData(body.value, body.encodingType);
    const dbResult = await createAppConfig(body, tx);
    return dbResult;
  });

  if (!result) {
    throw new ServerError("Failed to create app config");
  }
  await publishMessage(CHAN_ON_APPCONFIG_CHANGE, "");
  return { id: result.id };
}

function handleValidation(dataType: AppConfigDataTypes, value: any) {
  switch (dataType) {
    case "string":
      return;
    case "number":
      const parsed = z.coerce.number().safeParse(value);
      if (!parsed.success) {
        throw new BadRequestError("Value must be a number");
      }
      break;
    case "boolean":
      const parsedBoolean = z.coerce.boolean().safeParse(value);
      if (!parsedBoolean.success) {
        throw new BadRequestError("Value must be a boolean");
      }
      break;
  }
}
