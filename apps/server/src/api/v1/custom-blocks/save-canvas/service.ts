import type z from "zod";
import type { AuthACL } from "../../../../db/schema";
import { canAccess } from "../../../../lib/acl";
import { saveCanvas } from "../../../../modules/canvas/service";
import type { requestBodySchema } from "./dto";

export default async function handleRequest(
	customBlockId: string,
	data: z.infer<typeof requestBodySchema>,
	acl: AuthACL[],
) {
	await saveCanvas(
		{ type: "custom_block", id: customBlockId },
		data,
		acl.filter((a) => canAccess(a.role, "creator")).map((a) => a.projectId),
	);
}
