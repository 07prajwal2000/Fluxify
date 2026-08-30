import { z } from "zod";
import { AuthACL } from "../../../../db/schema";
import { getCanvas } from "../../../../modules/canvas/service";
import { mustAccess } from "../access";
import { responseSchema } from "./dto";

export default async function handleRequest(
	id: string,
	acl: AuthACL[],
): Promise<z.infer<typeof responseSchema>> {
	// a viewer may read a canvas, so access is settled here rather than by
	// the canvas service's project scoping
	await mustAccess(id, acl, "viewer");
	return await getCanvas({ type: "workflow", id }, ["*"]);
}
