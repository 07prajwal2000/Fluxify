import { DbTransactionType } from "../../../db";
import {
  deleteSystemUser,
  getSystemUserById,
} from "../../../lib/system-users";

// Deleting the system user cascades the Better Auth user + account/session.
export async function deleteUser(userId: string, tx?: DbTransactionType) {
  await deleteSystemUser(userId, tx);
}

export async function getUserRole(userId: string, tx?: DbTransactionType) {
  const su = await getSystemUserById(userId, tx);
  return su ? { isSystemAdmin: su.isSystemAdmin } : undefined;
}
