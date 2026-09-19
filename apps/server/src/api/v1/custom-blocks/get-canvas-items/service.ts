import type { User } from "better-auth";
import type z from "zod";
import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { getCanvas } from "../../../../modules/canvas/service";
import { hasProjectAccess } from "../../../auth/common";
import type { responseSchema } from "./dto";
import { getCustomBlockById } from "./repository";

export default async function handleRequest(
	id: string,
	user: User & { isSystemAdmin: boolean },
	acl: AuthACL[],
): Promise<z.infer<typeof responseSchema>> {
	const block = await getCustomBlockById(id);
	if (!block) {
		throw new NotFoundError("Custom block not found");
	}
	// viewers may read a custom block canvas, so access is decided here rather
	// than by the service's project scoping
	if (!hasProjectAccess(user, acl, block.projectId!, "viewer")) {
		throw new ForbiddenError();
	}

	return await getCanvas({ type: "custom_block", id }, ["*"]);
}
