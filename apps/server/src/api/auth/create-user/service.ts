import { requestBodySchema, responseSchema } from "./dto";
import { z } from "zod";
import { auth } from "../../../lib/auth";
import { getSetting } from "../../../loaders/instanceSettingsLoader";
import { ValidationError } from "../../../errors/validationError";
import { ConflictError } from "../../../errors/conflictError";
import {
  createSystemUser,
  getSystemUserByEmail,
} from "../../../lib/system-users";

export default async function handleRequest(
  data: z.infer<typeof requestBodySchema>
): Promise<z.infer<typeof responseSchema>> {
  const mode = getSetting("auth_config")?.mode ?? "traditional";

  if (await getSystemUserByEmail(data.email)) {
    throw new ConflictError("A user with this email already exists");
  }

  if (mode === "sso_only") {
    // SSO configured: create the canonical system_users row only. The Better
    // Auth user is JIT-created and linked (by email → shared id) on first SSO
    // login. Do NOT create a Better Auth user here (no password accounts).
    const sso = getSetting("sso_config");
    if (!sso) {
      throw new ValidationError([
        { field: "email", message: "SSO is not configured" },
      ]);
    }
    const domain = data.email.split("@")[1]?.toLowerCase();
    if (domain !== sso.domain.toLowerCase()) {
      throw new ValidationError([
        { field: "email", message: `Email must be on the ${sso.domain} domain` },
      ]);
    }
    const su = await createSystemUser({
      email: data.email,
      name: data.fullname,
      isSystemAdmin: data.isSystemAdmin,
    });
    return { id: su.id };
  }

  // traditional: create in BOTH tables. system_users first, then the Better
  // Auth user — the create.before hook links it by email (shared id).
  if (!data.password) {
    throw new ValidationError([
      { field: "password", message: "Password is required" },
    ]);
  }
  const su = await createSystemUser({
    email: data.email,
    name: data.fullname,
    isSystemAdmin: data.isSystemAdmin,
  });
  await auth.api.createUser({
    body: {
      email: data.email,
      name: data.fullname || "",
      password: data.password,
    },
  });
  return { id: su.id };
}
