// `bun run db:migrate`: what the admin server does on startup, without starting it.

import { migrateDB } from "../src/db/migration";
import { getEnv } from "../src/lib/env";

await migrateDB(getEnv("PG_URL")!);
