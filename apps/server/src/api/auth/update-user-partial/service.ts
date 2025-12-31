import { User } from "better-auth";
import { z } from "zod";
import { BadRequestError } from "../../../errors/badRequestError";
import { requestBodySchema, requestParamsSchema } from "./dto";
import { updateUser } from "./repository";
import { revokeSessions } from "../common";

export default async function handleRequest(
  user: User,
  params: z.infer<typeof requestParamsSchema>,
  body: z.infer<typeof requestBodySchema>
) {
  if (user.id === params.userId) {
    throw new BadRequestError("You are not allowed to update your own details");
  }

  await updateUser(params.userId, body);
  await revokeSessions(params.userId);
  return {
    message: "User updated successfully",
  };
}
