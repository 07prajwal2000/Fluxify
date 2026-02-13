import "dotenv/config";
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
      // Allow requests from localhost on common development ports
      if (origin?.startsWith("http://localhost:")) {
        return origin;
      }
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization", "Accept"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
    maxAge: 86400, // Cache preflight for 24 hours
  }),
);

async function main() {
  const adminRoutesEnabled = Boolean(process.env.ENABLE_ADMIN);
  app.onError(errorHandler);
  const db = await drizzleInit();
  await initializeRedis();
  await loadAppConfig();
  await loadIntegrations();
  if (adminRoutesEnabled) {
    await initDocsSearch();
    app.use("*", setSession);
    initializeAuth(db);
    authenticationRouter.registerHandler(app);
    mapVersionedAdminRoutes(app);
  }
  const parser = await loadRoutes();
  await mapRouter(app, parser);
}
main();

export { app };
