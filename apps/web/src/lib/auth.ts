import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/_/admin/api/auth/",
  baseURL:
    process.env.NODE_ENV === "production"
      ? process.env.SERVER_URL
      : "http://localhost:8000",

  sessionOptions: {
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  }, // 2 minutes
});
