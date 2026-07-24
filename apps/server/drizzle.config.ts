import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { getEnv } from "./src/lib/env";

export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: getEnv("PG_URL")!,
  },
});
