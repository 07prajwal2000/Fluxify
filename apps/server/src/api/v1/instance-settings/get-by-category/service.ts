import { redactSecrets } from "../../../../lib/instance-settings/schemas";
import { getInstanceSettingsByCategory } from "./repository";

export default async function handleRequest(category: string) {
	const rows = await getInstanceSettingsByCategory(category);
	return rows.map((row) => ({ ...row, value: redactSecrets(row.value) }));
}
