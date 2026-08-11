import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { BadRequestError } from "../../../errors/badRequestError";
import { revokeSessions } from "../common";
import { requestBodySchema, requestParamsSchema } from "./dto";
import { getCredentialAccount, updateCredentialPassword } from "./repository";

export default async function handleRequest(
	params: z.infer<typeof requestParamsSchema>,
	body: z.infer<typeof requestBodySchema>,
) {
	if (!(await getCredentialAccount(params.userId))) {
		throw new BadRequestError(
			"Passwords can only be changed for credential accounts",
		);
	}

	await updateCredentialPassword(
		params.userId,
		await hashPassword(body.newPassword),
	);
	await revokeSessions(params.userId);

	return { message: "Password updated successfully" };
}
