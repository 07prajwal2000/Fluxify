import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { currentEntitlement } from "../lib/edition";
import { DEV_WORKER_URL, RECORDING_MAX_AGE_DAYS } from "../lib/env";
import { getPublicSettings } from "../loaders/instanceSettingsLoader";
import { orchestrationEnabled } from "../modules/orchestrator/gate";
import type { HonoServer } from "../types";
import v1Register from "./v1/register";

export function mapVersionedAdminRoutes(app: HonoServer) {
	const router = app.basePath("/_/admin/api");
	// Public, unauthenticated feature flags. Secrets are stripped by each key's
	// publicSchema, so is_public rows never leak IdP credentials. `license` is
	// status only — never the licensee or the key.
	// `orchestration` is the deployment shape, not a licence or a DB row: Kit
	// has no orchestrator whatever key it holds, so the portal hides the claim
	// control and the Orchestration tab on it (§5a).
	router.get("/public-settings", (c) =>
		c.json({
			...getPublicSettings(),
			license: currentEntitlement(),
			orchestration: { enabled: orchestrationEnabled() },
			recordingMaxAgeDays: RECORDING_MAX_AGE_DAYS,
			// absent when unset: the portal then uses the project's own API address
			devWorkerUrl: DEV_WORKER_URL,
			// the editor loads `@types/bun` at this version
			bunVersion: Bun.version,
		}),
	);
	router.get("/openapi/ui", (c) => {
		try {
			const htmlContent = loadHtmlContent();
			return c.html(htmlContent);
		} catch (_error) {
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
	} catch (_error) {
		throw new Error("Failed to load OpenAPI UI file");
	}
}
