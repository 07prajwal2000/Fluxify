import z from "zod";
import { requestBodySchema } from "./dto";
import { AuthACL } from "../../../../db/schema";
import { canAccess } from "../../../../lib/acl";
import { saveCanvas } from "../../../../modules/canvas/service";

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
