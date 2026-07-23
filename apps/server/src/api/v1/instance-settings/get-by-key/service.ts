import { NotFoundError } from "../../../../errors/notFoundError";
import { redactSecrets } from "../../../../lib/instance-settings/schemas";
import { getInstanceSettingByKey } from "./repository";

export default async function handleRequest(key: string) {
	const setting = await getInstanceSettingByKey(key);
	if (!setting) {
		throw new NotFoundError(`Instance setting with key '${key}' not found`);
	}
	return { ...setting, value: redactSecrets(setting.value) };
}
