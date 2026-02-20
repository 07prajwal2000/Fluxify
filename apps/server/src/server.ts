import { Hono } from "hono";
import { cors } from "hono/cors";
import { mapRouter } from "./modules/requestRouter/router";
import { loadRoutes } from "./loaders/routesLoader";
import { drizzleInit } from "./db";
import { initializeRedis } from "./db/redis";
import { loadAppConfig } from "./loaders/appconfigLoader";
import { loadIntegrations } from "./loaders/integrationsLoader";
import { mapVersionedAdminRoutes } from "./api/register";
import { errorHandler } from "./middlewares/errorHandler";
import { auth, initializeAuth } from "./lib/auth";
import authenticationRouter from "./api/auth/register";
import { AccessControlRole } from "./db/schema";
import { setSession } from "./middlewares/session";
import { initDocsSearch } from "./lib/docs";

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
    acl: { projectId: string; role: AccessControlRole }[] | null;
  };
}>();

// Global CORS middleware
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (origin?.startsWith("http://localhost:")) {
        return origin;
      }
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization", "Accept"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
    maxAge: 86400,
  }),
);

function logSystemDetails() {
  console.log(`Admin routes enabled: ${process.env.ENABLE_ADMIN}`);
  console.log(`Node environment: ${process.env.ENVIRONMENT}`);
  console.log(`DB variant: ${process.env.DB_VARIANT}`);
}

async function main() {
  logSystemDetails();
  const adminRoutesEnabled = process.env.ENABLE_ADMIN == "true";
  app.onError(errorHandler);
  const db = await drizzleInit(adminRoutesEnabled);
  await initializeRedis();

  if (adminRoutesEnabled) {
    await initDocsSearch();
    app.use("*", setSession);
    initializeAuth(db);
    authenticationRouter.registerHandler(app);
    mapVersionedAdminRoutes(app);

    // Seed data if admin routes are enabled
    const { seedData } = await import("./db/seed");
    await seedData(db);
  }
  await loadAppConfig();
  await loadIntegrations();
  const parser = await loadRoutes();
  await mapRouter(app, parser);
}
if (process.env.NODE_ENV !== "test") {
  await main();
}

export { app };
