"use client";
import React, { useMemo } from "react";
import type { AccessControlRole } from "@fluxify/server/src/db/schema";
import { canAccess } from "@fluxify/server/src/lib/acl";
import { useAuthStore } from "@/store/auth";

type Props = {
  children?: React.ReactNode;
  requiredRole: AccessControlRole;
};

const RequireRoleInAnyProject = ({
  children,
  requiredRole: requireRole,
}: Props) => {
  const { acl, userData } = useAuthStore();

  const hasAccess = useMemo(() => {
    for (const projectId in acl) {
      if (canAccess(acl[projectId], requireRole)) {
        return true;
      }
    }
    return false;
  }, [acl]);

  if (userData?.isSystemAdmin) {
    return <>{children}</>;
  }

  if (!hasAccess) {
    return <></>;
  }

  return children;
};

export default RequireRoleInAnyProject;
