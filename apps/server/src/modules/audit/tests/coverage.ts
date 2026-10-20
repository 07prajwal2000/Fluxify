/**
 * Every non-GET admin route is either audited or skipped on purpose (#833).
 * `coverage.spec.ts` fails when a route is in neither list, so adding a
 * mutating route means choosing here: name the file that calls `audit.record`
 * for it, or say why it is not logged.
 *
 * Keys are the route's `operationId`, or `METHOD /path` (without the
 * `/_/admin/api` prefix) when it has none.
 */

const V = "api/v1";

/** operationId -> the source file (under `apps/server/src`) whose `audit.record` covers it */
export const AUDITED: Record<string, string> = {
	// users
	"auth-create-user": "api/auth/create-user/service.ts",
	"auth-update-user": "api/auth/update-user-partial/service.ts",
	"auth-delete-user": "api/auth/delete-user/service.ts",
	"auth-change-user-password": "api/auth/change-user-password/service.ts",
	// routes
	"create-route": `${V}/routes/create/service.ts`,
	"update-route": `${V}/routes/update/service.ts`,
	"delete-route": `${V}/routes/delete/service.ts`,
	"partial-update-route": `${V}/routes/update-partial/service.ts`,
	"set-route-middlewares": `${V}/middlewares/service.ts`,
	// canvases: one save path for every kind
	"save-canvas-state": "modules/canvas/service.ts",
	"save-workflow-canvas-state": "modules/canvas/service.ts",
	"save-sandbox-canvas-state": "modules/canvas/service.ts",
	"save-custom-block-canvas-state": "modules/canvas/service.ts",
	// versions and deployments: one service for every kind
	"commit-route-version": "modules/versions/service.ts",
	"commit-workflow-version": "modules/versions/service.ts",
	"commit-custom_block-version": "modules/versions/service.ts",
	"commit-middleware-version": "modules/versions/service.ts",
	"checkout-route-version": "modules/versions/service.ts",
	"checkout-workflow-version": "modules/versions/service.ts",
	"checkout-custom_block-version": "modules/versions/service.ts",
	"checkout-middleware-version": "modules/versions/service.ts",
	"deploy-route-version": "modules/deployments/service.ts",
	"deploy-workflow-version": "modules/deployments/service.ts",
	"deploy-custom_block-version": "modules/deployments/service.ts",
	"deploy-middleware-version": "modules/deployments/service.ts",
	// workflows, sandboxes
	"create-workflow": `${V}/workflows/service.ts`,
	"update-workflow": `${V}/workflows/service.ts`,
	"delete-workflow": `${V}/workflows/service.ts`,
	"create-sandbox": `${V}/sandboxes/service.ts`,
	"update-sandbox": `${V}/sandboxes/service.ts`,
	"delete-sandbox": `${V}/sandboxes/service.ts`,
	// triggers
	"create-trigger-group": `${V}/triggers/groups.ts`,
	"update-trigger-group": `${V}/triggers/groups.ts`,
	"delete-trigger-group": `${V}/triggers/groups.ts`,
	"create-trigger": `${V}/triggers/service.ts`,
	"update-trigger": `${V}/triggers/service.ts`,
	"attach-workflow": `${V}/triggers/service.ts`,
	"detach-workflow": `${V}/triggers/service.ts`,
	"delete-trigger": `${V}/triggers/service.ts`,
	// projects
	"create-project": `${V}/projects/create/service.ts`,
	"update-project": `${V}/projects/update/service.ts`,
	"delete-project": `${V}/projects/delete/service.ts`,
	"project-members-add": `${V}/projects/settings/members/add/service.ts`,
	"project-members-update": `${V}/projects/settings/members/update/service.ts`,
	"project-members-remove": `${V}/projects/settings/members/remove/service.ts`,
	"project-settings-keys-upsert": `${V}/projects/settings/keys/upsert/service.ts`,
	"project-dev-token-rotate": `${V}/projects/settings/dev-token/service.ts`,
	"project-packages-install": "modules/packages/service.ts",
	"project-packages-remove": "modules/packages/service.ts",
	// orchestration claims: project and instance routes share one service
	"create-project-claim": "modules/orchestrator/claims.ts",
	"update-project-claim": "modules/orchestrator/claims.ts",
	"release-project-claim": "modules/orchestrator/claims.ts",
	"create-instance-claim": "modules/orchestrator/claims.ts",
	"update-instance-claim": "modules/orchestrator/claims.ts",
	"release-instance-claim": "modules/orchestrator/claims.ts",
	// app configs
	"create-app-config": `${V}/app-config/create/service.ts`,
	"update-app-config": `${V}/app-config/update/service.ts`,
	"delete-app-config-by-id": `${V}/app-config/delete/service.ts`,
	"delete-app-configs-bulk": `${V}/app-config/delete-bulk/service.ts`,
	// integrations
	"create-integration": `${V}/integrations/create/service.ts`,
	"update-integration": `${V}/integrations/update/service.ts`,
	"delete-integration": `${V}/integrations/delete/service.ts`,
	"test-connection": `${V}/integrations/test-connection/service.ts`,
	"disconnect-mcp-oauth": `${V}/integrations/mcp-oauth/service.ts`,
	// knowledge sources
	"create-knowledge-source": `${V}/knowledge-sources/service.ts`,
	"update-knowledge-source": `${V}/knowledge-sources/service.ts`,
	"update-knowledge-source-page": `${V}/knowledge-sources/service.ts`,
	"refetch-knowledge-source": `${V}/knowledge-sources/service.ts`,
	"delete-knowledge-source": `${V}/knowledge-sources/service.ts`,
	// test suites and their runs
	"create-test-suite": `${V}/test-suites/create/service.ts`,
	"update-test-suite": `${V}/test-suites/update/service.ts`,
	"delete-test-suite": `${V}/test-suites/delete/service.ts`,
	"clone-test-suite": `${V}/test-suites/clone/service.ts`,
	"start-test-run": `${V}/test-suites/start-run/service.ts`,
	"delete-test-runs": `${V}/test-suites/delete-runs/service.ts`,
	// custom blocks, middlewares
	"create-custom-block": `${V}/custom-blocks/create/service.ts`,
	// audited through the create and canvas-save services it calls
	"extract-custom-block": `${V}/custom-blocks/create/service.ts`,
	"update-custom-block": `${V}/custom-blocks/update/service.ts`,
	"delete-custom-block": `${V}/custom-blocks/delete/service.ts`,
	"create-middleware": `${V}/middlewares/service.ts`,
	"update-middleware": `${V}/middlewares/service.ts`,
	"delete-middleware": `${V}/middlewares/service.ts`,
	// plugins (#857)
	"approve-plugin": "modules/plugins/service.ts",
	"scan-plugin": "modules/plugins/scanner.ts",
	"scan-plugins": "modules/plugins/scanner.ts",
	"reject-plugin": "modules/plugins/service.ts",
	"delete-plugin": "modules/plugins/remove.ts",
	"set-plugin-environments": "modules/plugins/service.ts",
	// plugin sources (#858): each registration and the two steps of a URL
	"upload-plugin": "modules/plugins/sources/archive.ts",
	"add-npm-plugin": "modules/plugins/sources/archive.ts",
	"add-fs-plugin": "modules/plugins/sources/archive.ts",
	"request-plugin-url": "modules/plugins/sources/url.ts",
	"fetch-plugin-url": "modules/plugins/sources/url.ts",
	// instance settings
	"set-license": `${V}/instance-settings/license/service.ts`,
	"upsert-instance-setting": `${V}/instance-settings/upsert/service.ts`,
	"patch-auth-settings": `${V}/instance-settings/patch-auth-settings/service.ts`,
};

const RUNS = "runs code and changes no stored configuration";
const SCOPE = "recorded run history, outside the #832 scope list; log it when asked";

/** routes that are deliberately not logged, and why */
export const SKIPPED: Record<string, string> = {
	"call-route": RUNS,
	"run-workflow": RUNS,
	"run-sandbox": RUNS,
	"call-sandbox": RUNS,
	"run-ephemeral-blocks": `${RUNS} (a scratch sandbox that is rolled back)`,
	"validate-test-suite": "checks a suite against its last run and changes nothing",
	"preview-llms-txt": "fetches a page to list its links and changes nothing",
	"connect-mcp-oauth":
		"only starts the sign-in; the connection it leads to is recorded when the callback completes it",
	"delete-recorded-runs": SCOPE,
	"delete-recorded-run": SCOPE,
	"POST /auth/oauth2/register":
		"anonymous OAuth client registration by an MCP client, rate limited; has no actor to name",
	"POST /auth/oauth2/token":
		"OAuth token exchange for an already registered client; the sign-in it follows is recorded",
	"POST /auth/*":
		"Better Auth's own endpoints: sign-in is recorded by its session hook, personal access token create and delete by its after hook; sign-out and the rest change no Fluxify resource",
};
