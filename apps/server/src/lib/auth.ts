import { betterAuth } from "better-auth";
import { DB, drizzleAdapter } from "better-auth/adapters/drizzle";
import { deleteCacheKey, getCache, setCache, setCacheEx } from "../db/redis";
import { accessControlEntity, projectsEntity } from "../db/schema";
import { eq } from "drizzle-orm";
import { customSession } from "better-auth/plugins";
import * as authSchemas from "../db/auth-schema";
import { admin } from "better-auth/plugins";
import { generateID } from "@fluxify/lib";

export let auth: ReturnType<typeof initializeAuth> = null!;

export function initializeAuth(db: DB) {
  const _auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchemas,
    }),
    trustedOrigins: [process.env.SERVER_URL!],
    user: {
      additionalFields: {
        isSystemAdmin: {
          type: "boolean",
          defaultValue: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
    },
    advanced: {
      database: {
        generateId: generateID,
      },
    },
    secondaryStorage: {
      async get(key: string) {
        return getCache(key);
      },
      async set(key: string, value: string, ttl?: number) {
        if (ttl) {
          await setCacheEx(key, value, ttl);
        } else {
          await setCache(key, value);
        }
      },
      async delete(key: string) {
        await deleteCacheKey(key);
      },
    },
    plugins: [
      customSession(async ({ user, session }) => {
        const acl = await getUserAccessControls(db, session.userId);
        return {
          user,
          session,
          acl, // extends session with acl
        };
      }),
      admin(),
    ],
  });
  auth = _auth;
  return _auth;
}

async function getUserAccessControls(db: DB, userId: string) {
  const user = await db
    .select()
    .from(authSchemas.user)
    .where(eq(authSchemas.user.id, userId));
  if (user[0]?.isSystemAdmin) {
    return [
      {
        projectId: "*",
        role: "system_admin",
      },
    ];
  }
  const userAccessControls = await db
    .select({
      projectId: accessControlEntity.projectId,
      role: accessControlEntity.role,
    })
    .from(accessControlEntity)
    .where(eq(accessControlEntity.userId, userId));
  return userAccessControls;
}
