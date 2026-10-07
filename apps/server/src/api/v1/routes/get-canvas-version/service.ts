import type { AuthACL } from "../../../../db/schema";
import { readCanvasVersion } from "../../../../modules/canvas/service";

/** same project scoping as get-canvas-items */
export default async function handleRequest(id: string, acl: AuthACL[] = []) {
	return await readCanvasVersion(
		{ type: "route", id },
		acl.map((a) => a.projectId),
	);
}
