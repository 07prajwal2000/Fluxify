import { z } from "zod";
import { requestBodySchema } from "./dto";
import { AuthACL } from "../../../../db/schema";
import { saveCanvas } from "../../../../modules/canvas/service";

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
