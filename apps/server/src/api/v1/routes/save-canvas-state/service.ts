import type { z } from "zod";
import type { AuthACL } from "../../../../db/schema";
import { saveCanvas } from "../../../../modules/canvas/service";
import type { requestBodySchema } from "./dto";

export default async function handleRequest(
	routeId: string,
	data: z.infer<typeof requestBodySchema>,
	acl: AuthACL[] = [],
) {
	await saveCanvas(
		{ type: "route", id: routeId },
		data,
		acl.map((a) => a.projectId),
	);
}
