import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { oauthClient, oauthConsent, systemUsers, user } from "../db/auth-schema";

/** The user still consents to the client, and the client is not disabled. */
export async function isOAuthGrantActive(clientId: string, userId: string) {
	const [grant] = await db
		.select({ disabled: oauthClient.disabled })
		.from(oauthConsent)
		.innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
		.where(and(eq(oauthConsent.clientId, clientId), eq(oauthConsent.userId, userId)))
		.limit(1);
	return !!grant && !grant.disabled;
}

/** The Better Auth user plus the system-admin flag, as a cookie session has it. */
export async function findTokenUser(userId: string) {
	const [row] = await db
		.select({ user, isSystemAdmin: systemUsers.isSystemAdmin })
		.from(user)
		.innerJoin(systemUsers, eq(systemUsers.id, user.id))
		.where(eq(user.id, userId));
	return row ? { ...row.user, isSystemAdmin: row.isSystemAdmin } : null;
}
