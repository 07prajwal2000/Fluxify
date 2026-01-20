import z from "zod";
import { db } from "../db";
import { CHAN_ON_APPCONFIG_CHANGE, subscribeToChannel } from "../db/redis";
import { appConfigEntity } from "../db/schema";
import { EncryptionService } from "../lib/encryption";

export let appConfigCache: Record<string, string | number | boolean> = {};

export async function loadAppConfig() {
  const configData = await loadConfigFromDB();
  subscribeToChannel(CHAN_ON_APPCONFIG_CHANGE, async () => {
    appConfigCache = await loadConfigFromDB();
    console.log("appconfig reloaded");
  });
  appConfigCache = configData;
}

async function loadConfigFromDB() {
  const configData = await db
    .select({
      key: appConfigEntity.keyName,
      value: appConfigEntity.value,
      isEncrypted: appConfigEntity.isEncrypted,
      encodingType: appConfigEntity.encodingType,
      dataType: appConfigEntity.dataType,
    })
    .from(appConfigEntity);
  const config: typeof appConfigCache = {};
  for (let cfg of configData) {
    let value = cfg.value;
    value = EncryptionService.decodeData(value!, cfg.encodingType!);
    if (cfg.isEncrypted) {
      value = EncryptionService.decrypt(value!);
    }
    switch (cfg.dataType) {
      case "string":
        config[cfg.key!] = value;
        break;
      case "boolean":
        config[cfg.key!] = z.boolean().safeParse(value).data || value;
        break;
      case "number":
        config[cfg.key!] = z.number().safeParse(value).data || value;
        break;
    }
  }
  return config;
}
