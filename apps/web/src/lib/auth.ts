import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/_/admin/api/auth/",
  baseURL: process.env.SERVER_URL,
  sessionOptions: {
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  }, // 2 minutes
});
