import { z } from "zod";
import { AuthACL } from "../../../../db/schema";
import { mustAccess } from "../access";
import { present } from "../shared";
import { responseSchema } from "./dto";

export default async function handleRequest(
	id: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
	return present(await mustAccess(id, acl, "viewer"));
}
