import { useEffect, useState } from "react";

// Public, unauthenticated: reads the platform login mode so forms can hide
// password fields when SSO is the only way in.
export function useAuthMode() {
  const [ssoOnly, setSsoOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/_/admin/api/public-settings", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setSsoOnly(data?.auth_config?.mode === "sso_only"))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { ssoOnly, loading };
}
