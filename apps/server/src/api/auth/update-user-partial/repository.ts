import { DbTransactionType } from "../../../db";
import { setSystemUserAdmin } from "../../../lib/system-users";

export async function updateUser(
  userId: string,
  data: { isSystemAdmin: boolean },
  tx?: DbTransactionType
) {
  await setSystemUserAdmin(userId, data.isSystemAdmin, tx);
}
