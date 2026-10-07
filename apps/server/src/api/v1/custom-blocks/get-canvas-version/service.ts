import type { User } from "better-auth";
import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { readCanvasVersion } from "../../../../modules/canvas/service";
import { hasProjectAccess } from "../../../auth/common";
import { getCustomBlockById } from "../get-canvas-items/repository";

/** same access rule as get-canvas-items: viewers may read */
export default async function handleRequest(
	id: string,
	user: User & { isSystemAdmin: boolean },
	acl: AuthACL[],
) {
	const block = await getCustomBlockById(id);
	if (!block) throw new NotFoundError("Custom block not found");
	if (!hasProjectAccess(user, acl, block.projectId!, "viewer")) throw new ForbiddenError();
	return await readCanvasVersion({ type: "custom_block", id }, ["*"]);
}
