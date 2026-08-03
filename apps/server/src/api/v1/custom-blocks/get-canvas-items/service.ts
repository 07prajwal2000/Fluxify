import z from "zod";
import { responseSchema } from "./dto";
import { getCustomBlockById } from "./repository";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { AuthACL } from "../../../../db/schema";
import { hasProjectAccess } from "../../../auth/common";
import { User } from "better-auth";
import { getCanvas } from "../../../../modules/canvas/service";

export default async function handleRequest(
  id: string,
  user: User & { isSystemAdmin: boolean },
  acl: AuthACL[]
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
