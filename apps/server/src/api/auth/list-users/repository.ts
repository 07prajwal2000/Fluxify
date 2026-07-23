import { DbTransactionType } from "../../../db";
import {
  countSystemUsers,
  listSystemUsers,
} from "../../../lib/system-users";

export async function getUsers(
  skip: number,
  limit: number,
  fuzzyTextSearch?: string,
  tx?: DbTransactionType
) {
  return listSystemUsers(skip, limit, fuzzyTextSearch, tx);
}

export async function getUsersCount(tx?: DbTransactionType) {
  return countSystemUsers(tx);
}
