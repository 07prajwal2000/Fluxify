import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditActor, AuditSource } from "./types";

/**
 * Who is making the current request. Set once by the auth step
 * (`middlewares/session.ts`) so no service needs a new argument. `actor` is
 * null for a caller with no user, such as the system access key.
 */
export type AuditContext = { actor: Omit<AuditActor, "source"> | null; source: AuditSource };

const store = new AsyncLocalStorage<AuditContext>();

export const runWithAuditContext = <T>(context: AuditContext, fn: () => T): T =>
	store.run(context, fn);

export const currentAuditContext = () => store.getStore();

/** The key-holder behind a request that carries the system access key and no user. */
export const SYSTEM_ACTOR = { actorId: "system", actorEmail: "system" } as const;
