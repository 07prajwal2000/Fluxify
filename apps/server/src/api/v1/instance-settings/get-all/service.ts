import { redactSecrets } from "../../../../lib/instance-settings/schemas";
import { getAllInstanceSettings } from "./repository";

export default async function handleRequest() {
	const rows = await getAllInstanceSettings();
	return rows.map((row) => ({ ...row, value: redactSecrets(row.value) }));
}
