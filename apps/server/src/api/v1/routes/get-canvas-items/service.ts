import { z } from "zod";
import { responseSchema } from "./dto";
import { AuthACL } from "../../../../db/schema";
import { getCanvas } from "../../../../modules/canvas/service";

export default async function handleRequest(
  id: string,
  acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
  return await getCanvas(
    { type: "route", id },
    acl.map((a) => a.projectId),
  );
}
