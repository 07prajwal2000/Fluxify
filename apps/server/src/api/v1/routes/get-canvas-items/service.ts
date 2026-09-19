import type { z } from "zod";
import type { AuthACL } from "../../../../db/schema";
import { getCanvas } from "../../../../modules/canvas/service";
import type { responseSchema } from "./dto";

export default async function handleRequest(
	id: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
	return await getCanvas(
		{ type: "route", id },
		acl.map((a) => a.projectId),
	);
}
