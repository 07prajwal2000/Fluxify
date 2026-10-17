import type { User } from "better-auth";
import type { z } from "zod";
import { BadRequestError } from "../../../errors/badRequestError";
import { audit, bodyFields } from "../../../modules/audit";
import { revokeSessions } from "../common";
import type { requestBodySchema, requestParamsSchema } from "./dto";
import { updateUser } from "./repository";

export default async function handleRequest(
	user: User,
	params: z.infer<typeof requestParamsSchema>,
	body: z.infer<typeof requestBodySchema>,
) {
	if (user.id === params.userId) {
		throw new BadRequestError("You are not allowed to update your own details");
	}

	await updateUser(params.userId, body);
	await audit.record({
		resourceType: "user",
		resourceId: params.userId,
		action: "update",
		changedFields: bodyFields(body),
	});
	await revokeSessions(params.userId);
	return {
		message: "User updated successfully",
	};
}
