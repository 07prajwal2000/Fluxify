import { requestBodySchema, responseSchema } from "./dto";
import { z } from "zod";
import { auth } from "../../../lib/auth";
import { db } from "../../../db";
import { user } from "../../../db/auth-schema";
import { generateID } from "@fluxify/lib";
import { getSetting } from "../../../loaders/instanceSettingsLoader";
import { ValidationError } from "../../../errors/validationError";

export default async function handleRequest(
  data: z.infer<typeof requestBodySchema>
): Promise<z.infer<typeof responseSchema>> {
  const mode = getSetting("auth_config")?.mode ?? "traditional";

  if (mode === "sso_only") {
    // Auth is offloaded to the IdP: create a pre-provisioned user row only,
    // no credential account. Enforce the IdP domain (no cross-domain accounts).
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
    const id = generateID();
    await db.insert(user).values({
      id,
      email: data.email,
      name: data.fullname || "",
      emailVerified: true,
      isSystemAdmin: data.isSystemAdmin,
    });
    return { id };
  }

  // traditional: email + password required
  if (!data.password) {
    throw new ValidationError([
      { field: "password", message: "Password is required" },
    ]);
  }
  const result = await auth.api.createUser({
    body: {
      email: data.email,
      name: data.fullname || "",
      password: data.password,
      data: {
        isSystemAdmin: data.isSystemAdmin,
      },
    },
  });
  return { id: su.id };
}
