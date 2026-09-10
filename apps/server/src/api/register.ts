import v1Register from "./v1/register";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { HonoServer } from "../types";
import { getPublicSettings } from "../loaders/instanceSettingsLoader";
import { currentEntitlement } from "../lib/edition";

export function mapVersionedAdminRoutes(app: HonoServer) {
  const router = app.basePath("/_/admin/api");
  // Public, unauthenticated feature flags. Secrets are stripped by each key's
  // publicSchema, so is_public rows never leak IdP credentials. `license` is
  // status only — never the licensee or the key.
  router.get("/public-settings", (c) =>
    c.json({ ...getPublicSettings(), license: currentEntitlement() }),
  );
  router.get("/openapi/ui", (c) => {
    try {
      const htmlContent = loadHtmlContent();
      return c.html(htmlContent);
    } catch (error) {
      return c.text("OpenAPI UI file not found", 404);
    }
  });
  v1Register.registerHandler(router);
}

let cachedHtmlContent: string | null = null;

function loadHtmlContent(): string {
  if (cachedHtmlContent) {
    return cachedHtmlContent;
  }

  try {
    const filePaths = [
      join(process.cwd(), "src/public/openapi.html"),
      join(process.cwd(), "apps/server/src/public/openapi.html"),
    ];
    for (const path of filePaths) {
      if (existsSync(path)) {
        cachedHtmlContent = readFileSync(path, "utf-8");
        return cachedHtmlContent;
      }
    }
    throw new Error("OpenAPI UI file not found");
  } catch (error) {
    throw new Error("Failed to load OpenAPI UI file");
  }
}
