import { User } from "better-auth";
import { AccessControlRole, AuthACL } from "../db/schema";

const roleHierarchy: Record<AccessControlRole, number> = {
  system_admin: 3,
  project_admin: 2,
  creator: 1,
  viewer: 0,
};

export function canAccess(
  userRole: AccessControlRole | AuthACL[],
  requiredRole: AccessControlRole
) {
  if (Array.isArray(userRole)) {
    return userRole.some(
      (acl) => roleHierarchy[acl.role] >= roleHierarchy[requiredRole]
    );
  }
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

export function canAccessProject(
  acl: AuthACL[],
  projectId: string,
  requiredRole: AccessControlRole,
  userData?: User & {
    isSystemAdmin: boolean;
  }
) {
  if (userData?.isSystemAdmin) {
    return true;
  }
  return acl.some(
    (item: AuthACL) =>
      (item.projectId === projectId || item.projectId === "*") &&
      canAccess(item.role, requiredRole)
  );
}
