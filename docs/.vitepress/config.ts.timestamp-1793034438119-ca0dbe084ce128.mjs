// docs/.vitepress/config.ts

import { defineConfig } from "file:///Users/yashash_kumar/fluxify/Fluxify/node_modules/.bun/vitepress@1.6.4+8a4df1f9d70c8496/node_modules/vitepress/dist/node/index.js";
import llmstxt from "file:///Users/yashash_kumar/fluxify/Fluxify/node_modules/.bun/vitepress-plugin-llms@1.14.0/node_modules/vitepress-plugin-llms/dist/index.js";
import { withMermaid } from "file:///Users/yashash_kumar/fluxify/Fluxify/node_modules/.bun/vitepress-plugin-mermaid@2.0.17+6ad6e3498b3b03e7/node_modules/vitepress-plugin-mermaid/dist/vitepress-plugin-mermaid.es.mjs";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
// docs/.vitepress/frontmatterDefaults.ts
import path from "node:path";
import { fileURLToPath } from "node:url";

var SKIP = [/^index\.md$/, /^blog\//];
var warned = /* @__PURE__ */ new Set();
function plainText(body) {
	return body
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/^:::.*$/gm, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^#+\s.*$/gm, " ")
		.replace(/[*_`>|]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}
function frontmatterDefaults(srcDir) {
	return {
		name: "fluxify:frontmatter-defaults",
		enforce: "pre",
		transform(code, id) {
			if (!id.endsWith(".md")) return null;
			const page = path.relative(srcDir, id).replaceAll("\\", "/");
			if (page.startsWith("..") || SKIP.some((re) => re.test(page))) return null;
			const text = code.replace(/\r\n/g, "\n");
			const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
			const yaml = match?.[1] ?? "";
			const body = match ? text.slice(match[0].length) : text;
			if (!body.trim()) return null;
			const added = [];
			if (!/^title:/m.test(yaml)) {
				const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
				added.push(`title: ${JSON.stringify(heading || "Untitled")}`);
			}
			if (!/^description:/m.test(yaml)) {
				added.push(`description: ${JSON.stringify(plainText(body).slice(0, 100))}`);
			}
			if (!added.length) return null;
			const fields = added.map((line) => line.split(":")[0]).join(" and ");
			if (!warned.has(page))
				console.warn(`[docs] ${page} has no ${fields} in its frontmatter; using a default`);
			warned.add(page);
			const frontmatter = [yaml, ...added].filter(Boolean).join("\n");
			return {
				code: `---
${frontmatter}
---
${body}`,
				map: null,
			};
		},
	};
}

// docs/.vitepress/config.ts
var __vite_injected_original_import_meta_url =
	"file:///Users/yashash_kumar/fluxify/Fluxify/docs/.vitepress/config.ts";
var SITE_URL = "https://docs.fluxify.rest";
var LLMS_SECTIONS = [
	"/getting-started/",
	"/concepts/",
	"/blocks/",
	"/plugins/",
	"/scripting/",
	"/testing/",
	"/integrations/",
	"/deployments/",
	"/architecture/",
];
var DOCS_DIR = fileURLToPath(new URL("..", __vite_injected_original_import_meta_url));
function agentPages() {
	return readdirSync(`${DOCS_DIR}agents`, { recursive: true })
		.map((f) => f.toString().replaceAll("\\", "/"))
		.filter((f) => f.endsWith(".md"))
		.sort((a, b) => Number(b === "index.md") - Number(a === "index.md") || a.localeCompare(b))
		.map((f) => {
			const text = readFileSync(`${DOCS_DIR}agents/${f}`, "utf8");
			const title = text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? f;
			return { text: title, link: `/agents/${f.replace(/(index)?\.md$/, "")}` };
		});
}
function llmsSidebar(sidebar) {
	const groups = sidebar ?? {};
	return [
		{ text: "For AI Agents (read first)", items: agentPages() },
		...LLMS_SECTIONS.flatMap((key) => groups[key] ?? []),
		{
			text: "Development",
			items: [{ text: "npm Packages", link: "/development/npm-packages" }],
		},
	];
}
function latestRelease() {
	if (process.env.FLUXIFY_RELEASE_TAG) return process.env.FLUXIFY_RELEASE_TAG;
	try {
		const tags = execSync("git tag --list v* --sort=-creatordate", { encoding: "utf8" });
		return tags.split("\n")[0] || "v0.0.0";
	} catch {
		return "v0.0.0";
	}
}
var releaseTag = latestRelease();
var config_default = withMermaid(
	defineConfig({
		title: "Fluxify",
		description:
			"Draw your backend. Ship it as code. A low-code platform to build APIs and background jobs visually.",
		lang: "en-US",
		// The docs live in the repo root /docs directory, so no srcDir needed.
		// Site is deployed at https://docs.fluxify.rest
		base: "/",
		// Warn on dead links but don't fail the build for pre-existing issues
		ignoreDeadLinks: true,
		// Absolute page URLs, for sitemap.xml
		sitemap: { hostname: SITE_URL },
		head: [
			["link", { rel: "icon", type: "image/x-icon", href: "/assets/favicon.ico" }],
			["link", { rel: "icon", type: "image/png", href: "/assets/logo.png" }],
			["meta", { name: "theme-color", content: "#000000" }],
		],
		// Source markdown lives in docs/, config is in docs/.vitepress/
		// VitePress picks this up automatically when run as `vitepress dev docs`
		themeConfig: {
			// https://vitepress.dev/reference/default-theme-config
			logo: "/assets/logo.png",
			siteTitle: "Fluxify",
			nav: [
				{ text: "Getting Started", link: "/getting-started/" },
				{
					text: "Concepts",
					items: [
						{ text: "Overview", link: "/concepts/" },
						{ text: "App Config", link: "/concepts/app-config" },
						{ text: "Audit Logs", link: "/concepts/audit-logs" },
						{ text: "Blocks", link: "/concepts/blocks" },
						{ text: "Edges", link: "/concepts/edges" },
						{ text: "Environments", link: "/concepts/environments" },
						{ text: "Execution Context", link: "/concepts/context" },
						{ text: "Execution Engine", link: "/concepts/execution-engine" },
						{ text: "Execution Recording", link: "/concepts/execution-recording" },
						{ text: "Globals", link: "/concepts/globals" },
						{ text: "HTTP Client", link: "/concepts/http-client" },
						{ text: "Evaluators", link: "/concepts/evaluators" },
						{ text: "Middlewares", link: "/concepts/middlewares" },
						{ text: "Response Schemas", link: "/concepts/response-schemas" },
						{ text: "Sandbox", link: "/concepts/sandbox" },
						{ text: "Workflows", link: "/concepts/workflows" },
						{ text: "Triggers", link: "/concepts/triggers" },
						{ text: "Schedules", link: "/concepts/schedules" },
						{ text: "Telemetry Configuration", link: "/concepts/telemetry-configuration" },
						{ text: "Versioning", link: "/concepts/versioning" },
						{ text: "Architecture", link: "/architecture/" },
						{ text: "Integrations", link: "/integrations/" },
					],
				},
				{
					text: "Blocks",
					items: [
						{ text: "Overview", link: "/blocks/" },
						{ text: "How They Work", link: "/blocks/how-they-work" },
						{ text: "List of Blocks", link: "/blocks/list-of-blocks" },
					],
				},
				{
					text: "Plugins",
					items: [
						{ text: "Overview", link: "/plugins/" },
						{ text: "Adding a Plugin", link: "/plugins/installing" },
						{ text: "Approval & Permissions", link: "/plugins/approving" },
						{ text: "Upgrading & Removing", link: "/plugins/upgrading" },
						{ text: "Status & Troubleshooting", link: "/plugins/status" },
						{ text: "Blocks on the Canvas", link: "/plugins/blocks-on-canvas" },
						{ text: "Writing a Plugin", link: "/plugins/authoring/getting-started" },
					],
				},
				{
					text: "Scripting",
					items: [
						{ text: "Overview", link: "/scripting/" },
						{ text: "Context", link: "/scripting/context" },
						{ text: "Where Your Code Runs", link: "/scripting/environments" },
						{ text: "How It Works", link: "/scripting/how-it-works" },
						{ text: "JavaScript API Reference", link: "/scripting/javascript-api" },
						{ text: "Key Considerations", link: "/scripting/key-considerations" },
						{ text: "Imports & Libraries", link: "/scripting/imports" },
					],
				},
				{
					text: "Testing",
					items: [
						{ text: "Overview", link: "/testing/" },
						{ text: "Your First Test Suite", link: "/testing/first-suite" },
						{ text: "Checking the Response", link: "/testing/checks" },
						{ text: "Hooks", link: "/testing/hooks" },
						{ text: "Setup and Teardown", link: "/testing/setup-and-teardown" },
						{ text: "Overrides", link: "/testing/overrides" },
						{ text: "Testing Workflows", link: "/testing/workflows" },
						{ text: "Reading Results", link: "/testing/results" },
					],
				},
				{ text: "Deployments", link: "/deployments/" },
			],
			sidebar: {
				"/getting-started/": [
					{
						text: "Getting Started",
						items: [
							{ text: "Overview", link: "/getting-started/" },
							{ text: "Guide", link: "/getting-started/basics" },
							{ text: "Routing & Validation", link: "/getting-started/routing" },
							{ text: "Connect an AI Agent", link: "/getting-started/ai-agents" },
							{ text: "Custom Knowledge Base", link: "/getting-started/knowledge-base" },
							{ text: "Contributing", link: "/getting-started/contributing" },
							{ text: "Local Testing", link: "/getting-started/local-testing" },
						],
					},
				],
				"/architecture/": [
					{
						text: "Architecture",
						items: [
							{ text: "Overview", link: "/architecture/" },
							{ text: "Request Lifecycle", link: "/architecture/request-lifecycle" },
							{ text: "The Orchestrator", link: "/architecture/orchestrator" },
							{ text: "Performance", link: "/architecture/performance" },
						],
					},
				],
				"/concepts/": [
					{
						text: "Concepts",
						items: [
							{ text: "Overview", link: "/concepts/" },
							{ text: "App Config", link: "/concepts/app-config" },
							{ text: "Audit Logs", link: "/concepts/audit-logs" },
							{ text: "Blocks", link: "/concepts/blocks" },
							{ text: "Edges", link: "/concepts/edges" },
							{ text: "Environments", link: "/concepts/environments" },
							{ text: "Execution Context", link: "/concepts/context" },
							{ text: "Execution Engine", link: "/concepts/execution-engine" },
							{ text: "Execution Recording", link: "/concepts/execution-recording" },
							{ text: "Globals", link: "/concepts/globals" },
							{ text: "HTTP Client", link: "/concepts/http-client" },
							{ text: "Evaluators", link: "/concepts/evaluators" },
							{ text: "Middlewares", link: "/concepts/middlewares" },
							{ text: "Sandbox", link: "/concepts/sandbox" },
							{ text: "Workflows", link: "/concepts/workflows" },
							{ text: "Triggers", link: "/concepts/triggers" },
							{ text: "Schedules", link: "/concepts/schedules" },
							{ text: "Telemetry Configuration", link: "/concepts/telemetry-configuration" },
							{ text: "Versioning", link: "/concepts/versioning" },
						],
					},
				],
				"/blocks/": [
					{
						text: "Blocks",
						items: [
							{ text: "Overview", link: "/blocks/" },
							{ text: "How They Work", link: "/blocks/how-they-work" },
							{ text: "List of Blocks", link: "/blocks/list-of-blocks" },
						],
					},
					{
						text: "Logic & Flow",
						items: [
							{ text: "Entrypoint", link: "/blocks/entrypoint" },
							{ text: "If Condition", link: "/blocks/if-condition" },
							{ text: "Switch", link: "/blocks/switch" },
							{ text: "For Loop", link: "/blocks/for-loop" },
							{ text: "For Each Loop", link: "/blocks/foreach-loop" },
							{ text: "Orchestrator", link: "/blocks/orchestrator" },
							{ text: "Retry", link: "/blocks/retry" },
							{ text: "Error Handler", link: "/blocks/error-handler" },
							{ text: "Response", link: "/blocks/response" },
						],
					},
					{
						text: "Data",
						items: [
							{ text: "Set Variable", link: "/blocks/set-var" },
							{ text: "Get Variable", link: "/blocks/get-var" },
							{ text: "Array Operations", link: "/blocks/array-operations" },
							{ text: "Transformer", link: "/blocks/transformer" },
							{ text: "JS Runner", link: "/blocks/js-runner" },
							{ text: "JS Runner Examples", link: "/blocks/js-runner-examples" },
						],
					},
					{
						text: "HTTP",
						items: [
							{ text: "HTTP Request", link: "/blocks/http-request" },
							{ text: "Get Query/Path Param", link: "/blocks/get-http-param" },
							{ text: "Get Header", link: "/blocks/get-http-header" },
							{ text: "Get Request Body", link: "/blocks/get-http-request-body" },
							{ text: "Set HTTP Header", link: "/blocks/set-http-header" },
							{ text: "Get Cookie", link: "/blocks/get-request-cookie" },
							{ text: "Set Cookie", link: "/blocks/set-http-cookie" },
						],
					},
					{
						text: "Database",
						items: [
							{ text: "DB Get All", link: "/blocks/db-get-all" },
							{ text: "DB Get Single", link: "/blocks/db-get-single" },
							{ text: "DB Row Exists", link: "/blocks/db-row-exists" },
							{ text: "DB Count", link: "/blocks/db-count" },
							{ text: "DB Insert", link: "/blocks/db-insert" },
							{ text: "DB Insert Bulk", link: "/blocks/db-insert-bulk" },
							{ text: "DB Update", link: "/blocks/db-update" },
							{ text: "DB Delete", link: "/blocks/db-delete" },
							{ text: "DB Transaction", link: "/blocks/db-transaction" },
							{ text: "Rollback Transaction", link: "/blocks/db-rollback" },
							{ text: "DB Native", link: "/blocks/db-native" },
							{ text: "Conditions", link: "/blocks/db-conditions" },
							{ text: "Joins", link: "/blocks/db-joins" },
							{ text: "Sorting & Paging", link: "/blocks/db-paging-sorting" },
						],
					},
					{
						text: "Key-Value",
						items: [
							{ text: "KV Operations", link: "/blocks/kv-operations" },
							{ text: "KV Raw Connection", link: "/blocks/kv-raw" },
						],
					},
					{
						text: "Message Queues",
						items: [{ text: "Send Message", link: "/blocks/send-message" }],
					},
					{
						text: "Logging",
						items: [
							{ text: "Console Log", link: "/blocks/console-log" },
							{ text: "Cloud Logs", link: "/blocks/cloud-logs" },
						],
					},
					{
						text: "Utility",
						items: [
							{ text: "Trigger Workflow", link: "/blocks/trigger-workflow" },
							{ text: "Sticky Note", link: "/blocks/sticky-note" },
						],
					},
					{
						text: "Custom Blocks",
						items: [
							{ text: "Overview", link: "/blocks/custom-blocks" },
							{ text: "Tutorial", link: "/blocks/custom-blocks-tutorial" },
						],
					},
				],
				"/plugins/": [
					{
						text: "Plugins",
						items: [
							{ text: "Overview", link: "/plugins/" },
							{ text: "Adding a Plugin", link: "/plugins/installing" },
							{ text: "Approval & Permissions", link: "/plugins/approving" },
							{ text: "Upgrading & Removing", link: "/plugins/upgrading" },
							{ text: "Status & Troubleshooting", link: "/plugins/status" },
							{ text: "Blocks on the Canvas", link: "/plugins/blocks-on-canvas" },
						],
					},
					{
						text: "Writing Plugins",
						items: [
							{ text: "Getting Started", link: "/plugins/authoring/getting-started" },
							{ text: "Blocks", link: "/plugins/authoring/blocks" },
							{ text: "Params", link: "/plugins/authoring/params" },
							{ text: "Handles", link: "/plugins/authoring/handles" },
							{ text: "Context", link: "/plugins/authoring/context" },
							{ text: "Integrations", link: "/plugins/authoring/integrations" },
							{ text: "Triggers", link: "/plugins/authoring/triggers" },
							{ text: "Testing", link: "/plugins/authoring/testing" },
							{ text: "Publishing", link: "/plugins/authoring/publishing" },
						],
					},
				],
				"/scripting/": [
					{
						text: "Scripting",
						items: [
							{ text: "Overview", link: "/scripting/" },
							{ text: "Context", link: "/scripting/context" },
							{ text: "Where Your Code Runs", link: "/scripting/environments" },
							{ text: "How It Works", link: "/scripting/how-it-works" },
							{ text: "JavaScript API Reference", link: "/scripting/javascript-api" },
							{
								text: "Key Considerations",
								link: "/scripting/key-considerations",
							},
							{ text: "Imports & Libraries", link: "/scripting/imports" },
						],
					},
				],
				"/testing/": [
					{
						text: "Testing",
						items: [
							{ text: "Overview", link: "/testing/" },
							{ text: "Your First Test Suite", link: "/testing/first-suite" },
							{ text: "Checking the Response", link: "/testing/checks" },
							{ text: "Hooks", link: "/testing/hooks" },
							{ text: "Setup and Teardown", link: "/testing/setup-and-teardown" },
							{ text: "Overrides", link: "/testing/overrides" },
							{ text: "Testing Workflows", link: "/testing/workflows" },
							{ text: "Reading Results", link: "/testing/results" },
						],
					},
				],
				"/deployments/": [
					{
						text: "Deployments",
						items: [
							{ text: "Self-Hosting", link: "/deployments/" },
							{ text: "Quick Run (Kit)", link: "/deployments/kit" },
							{ text: "Production (Admin + Workers)", link: "/deployments/production" },
							{ text: "Deploy with a Coding Agent", link: "/deployments/coding-agent" },
							{ text: "Editions", link: "/deployments/editions" },
							{ text: "Licenses & Contributions", link: "/deployments/licensing" },
							{ text: "Self-Signed Licenses (pre-1.0)", link: "/deployments/self-signed-license" },
						],
					},
					{
						text: "Kubernetes",
						items: [
							{ text: "Install on Kubernetes", link: "/deployments/kubernetes/install" },
							{ text: "Chart settings", link: "/deployments/kubernetes/helm-values" },
							{ text: "Logs and monitoring", link: "/deployments/kubernetes/observability" },
							{ text: "How it works", link: "/deployments/kubernetes/" },
							{ text: "Develop against a local cluster", link: "/deployments/kubernetes/local" },
						],
					},
				],
				"/integrations/": [
					{
						text: "Integrations",
						items: [
							{ text: "Overview", link: "/integrations/" },
							{ text: "Integrations from Plugins", link: "/integrations/plugin-integrations" },
							{ text: "Databases", link: "/integrations/databases" },
							{ text: "KV Stores", link: "/integrations/kv-stores" },
							{ text: "Observability", link: "/integrations/observability" },
							{ text: "AI Models", link: "/integrations/ai-models" },
							{ text: "Trace the AI Assistant", link: "/integrations/agent-tracing" },
							{ text: "Message Queues", link: "/integrations/message-queues" },
							{ text: "MCP Servers", link: "/integrations/mcp-servers" },
						],
					},
				],
			},
			// Edit link pointing to the GitHub source
			editLink: {
				pattern: "https://github.com/fluxify-rest/Fluxify/edit/main/docs/:path",
				text: "Edit this page on GitHub",
			},
			// Social links in the top-right nav
			socialLinks: [{ icon: "github", link: "https://github.com/fluxify-rest/Fluxify" }],
			// Footer
			footer: {
				message:
					"Released under the Apache License 2.0. Enterprise features are under the Fluxify Enterprise Edition License.",
				copyright: "Copyright \xA9 2026 Fluxify",
			},
			// Built-in local search (replaces mkdocs `search` plugin — no extra config needed)
			search: {
				provider: "local",
				options: {
					// agent pages stay out of the human search box (see agentPages)
					_render: (src, env, md) =>
						env.relativePath.startsWith("agents/") ? "" : md.render(src, env),
				},
			},
			// Outline (table of contents) — mirrors mkdocs toc_depth: 3
			outline: {
				level: [2, 3],
				label: "On This Page",
			},
			// Previous / next page links at the bottom
			docFooter: {
				prev: "Previous",
				next: "Next",
			},
			lastUpdated: {
				text: "Last updated",
			},
		},
		markdown: {
			// Line numbers in code blocks
			lineNumbers: false,
			// Container aliases that map mkdocs admonition-style blocks:
			// Use ::: tip / ::: warning / ::: danger / ::: info in markdown files.
		},
		vite: {
			plugins: [
				// order matters: both run before llmstxt reads the page
				frontmatterDefaults(DOCS_DIR),
				// %%RELEASE_TAG%% (v0.1.0) and %%CHART_VERSION%% (0.1.0) in any page, code
				// blocks included, become the newest release, in the HTML and the llms copies
				{
					name: "fluxify:release-version",
					enforce: "pre",
					transform(code, id) {
						if (!id.endsWith(".md") || !code.includes("%%")) return null;
						return code
							.replaceAll("%%RELEASE_TAG%%", releaseTag)
							.replaceAll("%%CHART_VERSION%%", releaseTag.replace(/^v/, ""));
					},
				},
				// llms.txt index, llms-full.txt and a .md copy of every page, for AI agents
				llmstxt({
					domain: SITE_URL,
					// empty placeholder pages (the real content is integrations/databases.md), and
					// blog posts, which the plugin's own blog preset misses under blog/posts/
					ignoreFiles: ["integrations/databases/*", "blog/**"],
					sidebar: llmsSidebar,
				}),
			],
			optimizeDeps: {
				// vitepress-plugin-mermaid injects the Mermaid component into every
				// page's client entry via a post-transform, which Vite's cold-start
				// dependency scanner doesn't see. Without this, mermaid (and its
				// CJS `dayjs` dependency) gets served unbundled on a fresh cache,
				// throwing "does not provide an export named 'default'".
				include: ["mermaid"],
			},
		},
	}),
);

export { config_default as default };
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiZG9jcy8udml0ZXByZXNzL2NvbmZpZy50cyIsICJkb2NzLy52aXRlcHJlc3MvZnJvbnRtYXR0ZXJEZWZhdWx0cy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy95YXNoYXNoX2t1bWFyL2ZsdXhpZnkvRmx1eGlmeS9kb2NzLy52aXRlcHJlc3NcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy95YXNoYXNoX2t1bWFyL2ZsdXhpZnkvRmx1eGlmeS9kb2NzLy52aXRlcHJlc3MvY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy95YXNoYXNoX2t1bWFyL2ZsdXhpZnkvRmx1eGlmeS9kb2NzLy52aXRlcHJlc3MvY29uZmlnLnRzXCI7aW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tIFwibm9kZTpjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyByZWFkZGlyU3luYywgcmVhZEZpbGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwibm9kZTp1cmxcIjtcbmltcG9ydCB7IHR5cGUgRGVmYXVsdFRoZW1lLCBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZXByZXNzXCI7XG5pbXBvcnQgbGxtc3R4dCBmcm9tIFwidml0ZXByZXNzLXBsdWdpbi1sbG1zXCI7XG5pbXBvcnQgeyB3aXRoTWVybWFpZCB9IGZyb20gXCJ2aXRlcHJlc3MtcGx1Z2luLW1lcm1haWRcIjtcbmltcG9ydCB7IGZyb250bWF0dGVyRGVmYXVsdHMgfSBmcm9tIFwiLi9mcm9udG1hdHRlckRlZmF1bHRzXCI7XG5cbmNvbnN0IFNJVEVfVVJMID0gXCJodHRwczovL2RvY3MuZmx1eGlmeS5yZXN0XCI7XG5cbi8qKiBTZWN0aW9uIG9yZGVyIGluIGxsbXMudHh0LiBFYWNoIGtleSBpcyBhIHNpZGViYXIgZ3JvdXAgaW4gdGhlIGNvbmZpZyBiZWxvdy4gKi9cbmNvbnN0IExMTVNfU0VDVElPTlMgPSBbXG5cdFwiL2dldHRpbmctc3RhcnRlZC9cIixcblx0XCIvY29uY2VwdHMvXCIsXG5cdFwiL2Jsb2Nrcy9cIixcblx0XCIvcGx1Z2lucy9cIixcblx0XCIvc2NyaXB0aW5nL1wiLFxuXHRcIi90ZXN0aW5nL1wiLFxuXHRcIi9pbnRlZ3JhdGlvbnMvXCIsXG5cdFwiL2RlcGxveW1lbnRzL1wiLFxuXHRcIi9hcmNoaXRlY3R1cmUvXCIsXG5dO1xuXG5jb25zdCBET0NTX0RJUiA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4uXCIsIGltcG9ydC5tZXRhLnVybCkpO1xuXG4vKipcbiAqIGRvY3MvYWdlbnRzLyBpcyB3cml0dGVuIGZvciBBSSBhZ2VudHM6IG5vIHNpZGViYXIgb3IgbmF2IGVudHJ5IGFuZCBsZWZ0IG91dFxuICogb2YgdGhlIHNpdGUgc2VhcmNoLCBidXQgbGlzdGVkIGZpcnN0IGluIGxsbXMudHh0LiBJdHMgcGFnZXMgYXJlIHJlYWQgZnJvbVxuICogZGlzaywgc28gYSBuZXcgb25lIG5lZWRzIG5vIGNvbmZpZyBjaGFuZ2UuIFRpdGxlcyBjb21lIGZyb20gZnJvbnRtYXR0ZXIuXG4gKi9cbmZ1bmN0aW9uIGFnZW50UGFnZXMoKTogRGVmYXVsdFRoZW1lLlNpZGViYXJJdGVtW10ge1xuXHRyZXR1cm4gcmVhZGRpclN5bmMoYCR7RE9DU19ESVJ9YWdlbnRzYCwgeyByZWN1cnNpdmU6IHRydWUgfSlcblx0XHQubWFwKChmKSA9PiBmLnRvU3RyaW5nKCkucmVwbGFjZUFsbChcIlxcXFxcIiwgXCIvXCIpKVxuXHRcdC5maWx0ZXIoKGYpID0+IGYuZW5kc1dpdGgoXCIubWRcIikpXG5cdFx0LnNvcnQoKGEsIGIpID0+IE51bWJlcihiID09PSBcImluZGV4Lm1kXCIpIC0gTnVtYmVyKGEgPT09IFwiaW5kZXgubWRcIikgfHwgYS5sb2NhbGVDb21wYXJlKGIpKVxuXHRcdC5tYXAoKGYpID0+IHtcblx0XHRcdGNvbnN0IHRleHQgPSByZWFkRmlsZVN5bmMoYCR7RE9DU19ESVJ9YWdlbnRzLyR7Zn1gLCBcInV0ZjhcIik7XG5cdFx0XHRjb25zdCB0aXRsZSA9IHRleHQubWF0Y2goL150aXRsZTpcXHMqW1wiJ10/KC4rPylbXCInXT9cXHMqJC9tKT8uWzFdID8/IGY7XG5cdFx0XHRyZXR1cm4geyB0ZXh0OiB0aXRsZSwgbGluazogYC9hZ2VudHMvJHtmLnJlcGxhY2UoLyhpbmRleCk/XFwubWQkLywgXCJcIil9YCB9O1xuXHRcdH0pO1xufVxuXG4vKiogVGhlIHNpZGViYXIgaW4gbGxtcy50eHQgb3JkZXIsIHBsdXMgcGFnZXMgdGhhdCBoYXZlIG5vIHNpZGViYXIgb2YgdGhlaXIgb3duLiAqL1xuZnVuY3Rpb24gbGxtc1NpZGViYXIoc2lkZWJhcjogRGVmYXVsdFRoZW1lLlNpZGViYXIgfCB1bmRlZmluZWQpIHtcblx0Y29uc3QgZ3JvdXBzID0gKHNpZGViYXIgPz8ge30pIGFzIERlZmF1bHRUaGVtZS5TaWRlYmFyTXVsdGk7XG5cdHJldHVybiBbXG5cdFx0eyB0ZXh0OiBcIkZvciBBSSBBZ2VudHMgKHJlYWQgZmlyc3QpXCIsIGl0ZW1zOiBhZ2VudFBhZ2VzKCkgfSxcblx0XHQuLi5MTE1TX1NFQ1RJT05TLmZsYXRNYXAoKGtleSkgPT4gZ3JvdXBzW2tleV0gPz8gW10pLFxuXHRcdHtcblx0XHRcdHRleHQ6IFwiRGV2ZWxvcG1lbnRcIixcblx0XHRcdGl0ZW1zOiBbeyB0ZXh0OiBcIm5wbSBQYWNrYWdlc1wiLCBsaW5rOiBcIi9kZXZlbG9wbWVudC9ucG0tcGFja2FnZXNcIiB9XSxcblx0XHR9LFxuXHRdIGFzIERlZmF1bHRUaGVtZS5TaWRlYmFySXRlbVtdO1xufVxuXG4vKipcbiAqIFRoZSBuZXdlc3QgcmVsZWFzZSwgcHJlLXJlbGVhc2VzIGluY2x1ZGVkLCBzbyBpbnN0YWxsIGNvbW1hbmRzIGNhbiBiZVxuICogY29waWVkIGFzIHRoZXkgYXJlLiBDSSBwYXNzZXMgaXQgaW47IGEgbG9jYWwgYnVpbGQgcmVhZHMgdGhlIG5ld2VzdCB0YWcuXG4gKi9cbmZ1bmN0aW9uIGxhdGVzdFJlbGVhc2UoKTogc3RyaW5nIHtcblx0aWYgKHByb2Nlc3MuZW52LkZMVVhJRllfUkVMRUFTRV9UQUcpIHJldHVybiBwcm9jZXNzLmVudi5GTFVYSUZZX1JFTEVBU0VfVEFHO1xuXHR0cnkge1xuXHRcdGNvbnN0IHRhZ3MgPSBleGVjU3luYyhcImdpdCB0YWcgLS1saXN0IHYqIC0tc29ydD0tY3JlYXRvcmRhdGVcIiwgeyBlbmNvZGluZzogXCJ1dGY4XCIgfSk7XG5cdFx0cmV0dXJuIHRhZ3Muc3BsaXQoXCJcXG5cIilbMF0gfHwgXCJ2MC4wLjBcIjtcblx0fSBjYXRjaCB7XG5cdFx0cmV0dXJuIFwidjAuMC4wXCI7XG5cdH1cbn1cbmNvbnN0IHJlbGVhc2VUYWcgPSBsYXRlc3RSZWxlYXNlKCk7XG5cbi8vIHdpdGhNZXJtYWlkIHdyYXBzIHRoZSBjb25maWcgc28gYGBgbWVybWFpZCBjb2RlIGZlbmNlcyByZW5kZXIgYXMgZGlhZ3JhbXMuXG4vLyBodHRwczovL3ZpdGVwcmVzcy5kZXYvcmVmZXJlbmNlL3NpdGUtY29uZmlnXG5leHBvcnQgZGVmYXVsdCB3aXRoTWVybWFpZChcblx0ZGVmaW5lQ29uZmlnKHtcblx0XHR0aXRsZTogXCJGbHV4aWZ5XCIsXG5cdFx0ZGVzY3JpcHRpb246XG5cdFx0XHRcIkRyYXcgeW91ciBiYWNrZW5kLiBTaGlwIGl0IGFzIGNvZGUuIEEgbG93LWNvZGUgcGxhdGZvcm0gdG8gYnVpbGQgQVBJcyBhbmQgYmFja2dyb3VuZCBqb2JzIHZpc3VhbGx5LlwiLFxuXHRcdGxhbmc6IFwiZW4tVVNcIixcblxuXHRcdC8vIFRoZSBkb2NzIGxpdmUgaW4gdGhlIHJlcG8gcm9vdCAvZG9jcyBkaXJlY3RvcnksIHNvIG5vIHNyY0RpciBuZWVkZWQuXG5cdFx0Ly8gU2l0ZSBpcyBkZXBsb3llZCBhdCBodHRwczovL2RvY3MuZmx1eGlmeS5yZXN0XG5cdFx0YmFzZTogXCIvXCIsXG5cblx0XHQvLyBXYXJuIG9uIGRlYWQgbGlua3MgYnV0IGRvbid0IGZhaWwgdGhlIGJ1aWxkIGZvciBwcmUtZXhpc3RpbmcgaXNzdWVzXG5cdFx0aWdub3JlRGVhZExpbmtzOiB0cnVlLFxuXG5cdFx0Ly8gQWJzb2x1dGUgcGFnZSBVUkxzLCBmb3Igc2l0ZW1hcC54bWxcblx0XHRzaXRlbWFwOiB7IGhvc3RuYW1lOiBTSVRFX1VSTCB9LFxuXG5cdFx0aGVhZDogW1xuXHRcdFx0W1wibGlua1wiLCB7IHJlbDogXCJpY29uXCIsIHR5cGU6IFwiaW1hZ2UveC1pY29uXCIsIGhyZWY6IFwiL2Fzc2V0cy9mYXZpY29uLmljb1wiIH1dLFxuXHRcdFx0W1wibGlua1wiLCB7IHJlbDogXCJpY29uXCIsIHR5cGU6IFwiaW1hZ2UvcG5nXCIsIGhyZWY6IFwiL2Fzc2V0cy9sb2dvLnBuZ1wiIH1dLFxuXHRcdFx0W1wibWV0YVwiLCB7IG5hbWU6IFwidGhlbWUtY29sb3JcIiwgY29udGVudDogXCIjMDAwMDAwXCIgfV0sXG5cdFx0XSxcblxuXHRcdC8vIFNvdXJjZSBtYXJrZG93biBsaXZlcyBpbiBkb2NzLywgY29uZmlnIGlzIGluIGRvY3MvLnZpdGVwcmVzcy9cblx0XHQvLyBWaXRlUHJlc3MgcGlja3MgdGhpcyB1cCBhdXRvbWF0aWNhbGx5IHdoZW4gcnVuIGFzIGB2aXRlcHJlc3MgZGV2IGRvY3NgXG5cblx0XHR0aGVtZUNvbmZpZzoge1xuXHRcdFx0Ly8gaHR0cHM6Ly92aXRlcHJlc3MuZGV2L3JlZmVyZW5jZS9kZWZhdWx0LXRoZW1lLWNvbmZpZ1xuXHRcdFx0bG9nbzogXCIvYXNzZXRzL2xvZ28ucG5nXCIsXG5cdFx0XHRzaXRlVGl0bGU6IFwiRmx1eGlmeVwiLFxuXG5cdFx0XHRuYXY6IFtcblx0XHRcdFx0eyB0ZXh0OiBcIkdldHRpbmcgU3RhcnRlZFwiLCBsaW5rOiBcIi9nZXR0aW5nLXN0YXJ0ZWQvXCIgfSxcblx0XHRcdFx0e1xuXHRcdFx0XHRcdHRleHQ6IFwiQ29uY2VwdHNcIixcblx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL2NvbmNlcHRzL1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiQXBwIENvbmZpZ1wiLCBsaW5rOiBcIi9jb25jZXB0cy9hcHAtY29uZmlnXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJBdWRpdCBMb2dzXCIsIGxpbms6IFwiL2NvbmNlcHRzL2F1ZGl0LWxvZ3NcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkJsb2Nrc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9ibG9ja3NcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkVkZ2VzXCIsIGxpbms6IFwiL2NvbmNlcHRzL2VkZ2VzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJFbnZpcm9ubWVudHNcIiwgbGluazogXCIvY29uY2VwdHMvZW52aXJvbm1lbnRzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJFeGVjdXRpb24gQ29udGV4dFwiLCBsaW5rOiBcIi9jb25jZXB0cy9jb250ZXh0XCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJFeGVjdXRpb24gRW5naW5lXCIsIGxpbms6IFwiL2NvbmNlcHRzL2V4ZWN1dGlvbi1lbmdpbmVcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkV4ZWN1dGlvbiBSZWNvcmRpbmdcIiwgbGluazogXCIvY29uY2VwdHMvZXhlY3V0aW9uLXJlY29yZGluZ1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiR2xvYmFsc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9nbG9iYWxzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJIVFRQIENsaWVudFwiLCBsaW5rOiBcIi9jb25jZXB0cy9odHRwLWNsaWVudFwiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiRXZhbHVhdG9yc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9ldmFsdWF0b3JzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJNaWRkbGV3YXJlc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9taWRkbGV3YXJlc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiUmVzcG9uc2UgU2NoZW1hc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9yZXNwb25zZS1zY2hlbWFzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJTYW5kYm94XCIsIGxpbms6IFwiL2NvbmNlcHRzL3NhbmRib3hcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIldvcmtmbG93c1wiLCBsaW5rOiBcIi9jb25jZXB0cy93b3JrZmxvd3NcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlRyaWdnZXJzXCIsIGxpbms6IFwiL2NvbmNlcHRzL3RyaWdnZXJzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJTY2hlZHVsZXNcIiwgbGluazogXCIvY29uY2VwdHMvc2NoZWR1bGVzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJUZWxlbWV0cnkgQ29uZmlndXJhdGlvblwiLCBsaW5rOiBcIi9jb25jZXB0cy90ZWxlbWV0cnktY29uZmlndXJhdGlvblwiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiVmVyc2lvbmluZ1wiLCBsaW5rOiBcIi9jb25jZXB0cy92ZXJzaW9uaW5nXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJBcmNoaXRlY3R1cmVcIiwgbGluazogXCIvYXJjaGl0ZWN0dXJlL1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiSW50ZWdyYXRpb25zXCIsIGxpbms6IFwiL2ludGVncmF0aW9ucy9cIiB9LFxuXHRcdFx0XHRcdF0sXG5cdFx0XHRcdH0sXG5cdFx0XHRcdHtcblx0XHRcdFx0XHR0ZXh0OiBcIkJsb2Nrc1wiLFxuXHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiT3ZlcnZpZXdcIiwgbGluazogXCIvYmxvY2tzL1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiSG93IFRoZXkgV29ya1wiLCBsaW5rOiBcIi9ibG9ja3MvaG93LXRoZXktd29ya1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiTGlzdCBvZiBCbG9ja3NcIiwgbGluazogXCIvYmxvY2tzL2xpc3Qtb2YtYmxvY2tzXCIgfSxcblx0XHRcdFx0XHRdLFxuXHRcdFx0XHR9LFxuXHRcdFx0XHR7XG5cdFx0XHRcdFx0dGV4dDogXCJQbHVnaW5zXCIsXG5cdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9wbHVnaW5zL1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiQWRkaW5nIGEgUGx1Z2luXCIsIGxpbms6IFwiL3BsdWdpbnMvaW5zdGFsbGluZ1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiQXBwcm92YWwgJiBQZXJtaXNzaW9uc1wiLCBsaW5rOiBcIi9wbHVnaW5zL2FwcHJvdmluZ1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiVXBncmFkaW5nICYgUmVtb3ZpbmdcIiwgbGluazogXCIvcGx1Z2lucy91cGdyYWRpbmdcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlN0YXR1cyAmIFRyb3VibGVzaG9vdGluZ1wiLCBsaW5rOiBcIi9wbHVnaW5zL3N0YXR1c1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiQmxvY2tzIG9uIHRoZSBDYW52YXNcIiwgbGluazogXCIvcGx1Z2lucy9ibG9ja3Mtb24tY2FudmFzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJXcml0aW5nIGEgUGx1Z2luXCIsIGxpbms6IFwiL3BsdWdpbnMvYXV0aG9yaW5nL2dldHRpbmctc3RhcnRlZFwiIH0sXG5cdFx0XHRcdFx0XSxcblx0XHRcdFx0fSxcblx0XHRcdFx0e1xuXHRcdFx0XHRcdHRleHQ6IFwiU2NyaXB0aW5nXCIsXG5cdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9zY3JpcHRpbmcvXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJDb250ZXh0XCIsIGxpbms6IFwiL3NjcmlwdGluZy9jb250ZXh0XCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJXaGVyZSBZb3VyIENvZGUgUnVuc1wiLCBsaW5rOiBcIi9zY3JpcHRpbmcvZW52aXJvbm1lbnRzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJIb3cgSXQgV29ya3NcIiwgbGluazogXCIvc2NyaXB0aW5nL2hvdy1pdC13b3Jrc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiSmF2YVNjcmlwdCBBUEkgUmVmZXJlbmNlXCIsIGxpbms6IFwiL3NjcmlwdGluZy9qYXZhc2NyaXB0LWFwaVwiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiS2V5IENvbnNpZGVyYXRpb25zXCIsIGxpbms6IFwiL3NjcmlwdGluZy9rZXktY29uc2lkZXJhdGlvbnNcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkltcG9ydHMgJiBMaWJyYXJpZXNcIiwgbGluazogXCIvc2NyaXB0aW5nL2ltcG9ydHNcIiB9LFxuXHRcdFx0XHRcdF0sXG5cdFx0XHRcdH0sXG5cdFx0XHRcdHtcblx0XHRcdFx0XHR0ZXh0OiBcIlRlc3RpbmdcIixcblx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL3Rlc3RpbmcvXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJZb3VyIEZpcnN0IFRlc3QgU3VpdGVcIiwgbGluazogXCIvdGVzdGluZy9maXJzdC1zdWl0ZVwiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ2hlY2tpbmcgdGhlIFJlc3BvbnNlXCIsIGxpbms6IFwiL3Rlc3RpbmcvY2hlY2tzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJIb29rc1wiLCBsaW5rOiBcIi90ZXN0aW5nL2hvb2tzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJTZXR1cCBhbmQgVGVhcmRvd25cIiwgbGluazogXCIvdGVzdGluZy9zZXR1cC1hbmQtdGVhcmRvd25cIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJyaWRlc1wiLCBsaW5rOiBcIi90ZXN0aW5nL292ZXJyaWRlc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiVGVzdGluZyBXb3JrZmxvd3NcIiwgbGluazogXCIvdGVzdGluZy93b3JrZmxvd3NcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlJlYWRpbmcgUmVzdWx0c1wiLCBsaW5rOiBcIi90ZXN0aW5nL3Jlc3VsdHNcIiB9LFxuXHRcdFx0XHRcdF0sXG5cdFx0XHRcdH0sXG5cdFx0XHRcdHsgdGV4dDogXCJEZXBsb3ltZW50c1wiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9cIiB9LFxuXHRcdFx0XSxcblxuXHRcdFx0c2lkZWJhcjoge1xuXHRcdFx0XHRcIi9nZXR0aW5nLXN0YXJ0ZWQvXCI6IFtcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkdldHRpbmcgU3RhcnRlZFwiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL2dldHRpbmctc3RhcnRlZC9cIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiR3VpZGVcIiwgbGluazogXCIvZ2V0dGluZy1zdGFydGVkL2Jhc2ljc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJSb3V0aW5nICYgVmFsaWRhdGlvblwiLCBsaW5rOiBcIi9nZXR0aW5nLXN0YXJ0ZWQvcm91dGluZ1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJDb25uZWN0IGFuIEFJIEFnZW50XCIsIGxpbms6IFwiL2dldHRpbmctc3RhcnRlZC9haS1hZ2VudHNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ3VzdG9tIEtub3dsZWRnZSBCYXNlXCIsIGxpbms6IFwiL2dldHRpbmctc3RhcnRlZC9rbm93bGVkZ2UtYmFzZVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJDb250cmlidXRpbmdcIiwgbGluazogXCIvZ2V0dGluZy1zdGFydGVkL2NvbnRyaWJ1dGluZ1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJMb2NhbCBUZXN0aW5nXCIsIGxpbms6IFwiL2dldHRpbmctc3RhcnRlZC9sb2NhbC10ZXN0aW5nXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XSxcblxuXHRcdFx0XHRcIi9hcmNoaXRlY3R1cmUvXCI6IFtcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkFyY2hpdGVjdHVyZVwiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL2FyY2hpdGVjdHVyZS9cIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUmVxdWVzdCBMaWZlY3ljbGVcIiwgbGluazogXCIvYXJjaGl0ZWN0dXJlL3JlcXVlc3QtbGlmZWN5Y2xlXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlRoZSBPcmNoZXN0cmF0b3JcIiwgbGluazogXCIvYXJjaGl0ZWN0dXJlL29yY2hlc3RyYXRvclwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJQZXJmb3JtYW5jZVwiLCBsaW5rOiBcIi9hcmNoaXRlY3R1cmUvcGVyZm9ybWFuY2VcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRdLFxuXG5cdFx0XHRcdFwiL2NvbmNlcHRzL1wiOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJDb25jZXB0c1wiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL2NvbmNlcHRzL1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJBcHAgQ29uZmlnXCIsIGxpbms6IFwiL2NvbmNlcHRzL2FwcC1jb25maWdcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQXVkaXQgTG9nc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9hdWRpdC1sb2dzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkJsb2Nrc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9ibG9ja3NcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiRWRnZXNcIiwgbGluazogXCIvY29uY2VwdHMvZWRnZXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiRW52aXJvbm1lbnRzXCIsIGxpbms6IFwiL2NvbmNlcHRzL2Vudmlyb25tZW50c1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJFeGVjdXRpb24gQ29udGV4dFwiLCBsaW5rOiBcIi9jb25jZXB0cy9jb250ZXh0XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkV4ZWN1dGlvbiBFbmdpbmVcIiwgbGluazogXCIvY29uY2VwdHMvZXhlY3V0aW9uLWVuZ2luZVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJFeGVjdXRpb24gUmVjb3JkaW5nXCIsIGxpbms6IFwiL2NvbmNlcHRzL2V4ZWN1dGlvbi1yZWNvcmRpbmdcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiR2xvYmFsc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9nbG9iYWxzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkhUVFAgQ2xpZW50XCIsIGxpbms6IFwiL2NvbmNlcHRzL2h0dHAtY2xpZW50XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkV2YWx1YXRvcnNcIiwgbGluazogXCIvY29uY2VwdHMvZXZhbHVhdG9yc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJNaWRkbGV3YXJlc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9taWRkbGV3YXJlc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJTYW5kYm94XCIsIGxpbms6IFwiL2NvbmNlcHRzL3NhbmRib3hcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiV29ya2Zsb3dzXCIsIGxpbms6IFwiL2NvbmNlcHRzL3dvcmtmbG93c1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUcmlnZ2Vyc1wiLCBsaW5rOiBcIi9jb25jZXB0cy90cmlnZ2Vyc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJTY2hlZHVsZXNcIiwgbGluazogXCIvY29uY2VwdHMvc2NoZWR1bGVzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlRlbGVtZXRyeSBDb25maWd1cmF0aW9uXCIsIGxpbms6IFwiL2NvbmNlcHRzL3RlbGVtZXRyeS1jb25maWd1cmF0aW9uXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlZlcnNpb25pbmdcIiwgbGluazogXCIvY29uY2VwdHMvdmVyc2lvbmluZ1wiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cblx0XHRcdFx0XCIvYmxvY2tzL1wiOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJCbG9ja3NcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9ibG9ja3MvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkhvdyBUaGV5IFdvcmtcIiwgbGluazogXCIvYmxvY2tzL2hvdy10aGV5LXdvcmtcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiTGlzdCBvZiBCbG9ja3NcIiwgbGluazogXCIvYmxvY2tzL2xpc3Qtb2YtYmxvY2tzXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkxvZ2ljICYgRmxvd1wiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkVudHJ5cG9pbnRcIiwgbGluazogXCIvYmxvY2tzL2VudHJ5cG9pbnRcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiSWYgQ29uZGl0aW9uXCIsIGxpbms6IFwiL2Jsb2Nrcy9pZi1jb25kaXRpb25cIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU3dpdGNoXCIsIGxpbms6IFwiL2Jsb2Nrcy9zd2l0Y2hcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiRm9yIExvb3BcIiwgbGluazogXCIvYmxvY2tzL2Zvci1sb29wXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkZvciBFYWNoIExvb3BcIiwgbGluazogXCIvYmxvY2tzL2ZvcmVhY2gtbG9vcFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPcmNoZXN0cmF0b3JcIiwgbGluazogXCIvYmxvY2tzL29yY2hlc3RyYXRvclwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJSZXRyeVwiLCBsaW5rOiBcIi9ibG9ja3MvcmV0cnlcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiRXJyb3IgSGFuZGxlclwiLCBsaW5rOiBcIi9ibG9ja3MvZXJyb3ItaGFuZGxlclwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJSZXNwb25zZVwiLCBsaW5rOiBcIi9ibG9ja3MvcmVzcG9uc2VcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiRGF0YVwiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlNldCBWYXJpYWJsZVwiLCBsaW5rOiBcIi9ibG9ja3Mvc2V0LXZhclwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJHZXQgVmFyaWFibGVcIiwgbGluazogXCIvYmxvY2tzL2dldC12YXJcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQXJyYXkgT3BlcmF0aW9uc1wiLCBsaW5rOiBcIi9ibG9ja3MvYXJyYXktb3BlcmF0aW9uc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUcmFuc2Zvcm1lclwiLCBsaW5rOiBcIi9ibG9ja3MvdHJhbnNmb3JtZXJcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiSlMgUnVubmVyXCIsIGxpbms6IFwiL2Jsb2Nrcy9qcy1ydW5uZXJcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiSlMgUnVubmVyIEV4YW1wbGVzXCIsIGxpbms6IFwiL2Jsb2Nrcy9qcy1ydW5uZXItZXhhbXBsZXNcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiSFRUUFwiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkhUVFAgUmVxdWVzdFwiLCBsaW5rOiBcIi9ibG9ja3MvaHR0cC1yZXF1ZXN0XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkdldCBRdWVyeS9QYXRoIFBhcmFtXCIsIGxpbms6IFwiL2Jsb2Nrcy9nZXQtaHR0cC1wYXJhbVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJHZXQgSGVhZGVyXCIsIGxpbms6IFwiL2Jsb2Nrcy9nZXQtaHR0cC1oZWFkZXJcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiR2V0IFJlcXVlc3QgQm9keVwiLCBsaW5rOiBcIi9ibG9ja3MvZ2V0LWh0dHAtcmVxdWVzdC1ib2R5XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlNldCBIVFRQIEhlYWRlclwiLCBsaW5rOiBcIi9ibG9ja3Mvc2V0LWh0dHAtaGVhZGVyXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkdldCBDb29raWVcIiwgbGluazogXCIvYmxvY2tzL2dldC1yZXF1ZXN0LWNvb2tpZVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJTZXQgQ29va2llXCIsIGxpbms6IFwiL2Jsb2Nrcy9zZXQtaHR0cC1jb29raWVcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiRGF0YWJhc2VcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJEQiBHZXQgQWxsXCIsIGxpbms6IFwiL2Jsb2Nrcy9kYi1nZXQtYWxsXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRCIEdldCBTaW5nbGVcIiwgbGluazogXCIvYmxvY2tzL2RiLWdldC1zaW5nbGVcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiREIgUm93IEV4aXN0c1wiLCBsaW5rOiBcIi9ibG9ja3MvZGItcm93LWV4aXN0c1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJEQiBDb3VudFwiLCBsaW5rOiBcIi9ibG9ja3MvZGItY291bnRcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiREIgSW5zZXJ0XCIsIGxpbms6IFwiL2Jsb2Nrcy9kYi1pbnNlcnRcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiREIgSW5zZXJ0IEJ1bGtcIiwgbGluazogXCIvYmxvY2tzL2RiLWluc2VydC1idWxrXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRCIFVwZGF0ZVwiLCBsaW5rOiBcIi9ibG9ja3MvZGItdXBkYXRlXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRCIERlbGV0ZVwiLCBsaW5rOiBcIi9ibG9ja3MvZGItZGVsZXRlXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRCIFRyYW5zYWN0aW9uXCIsIGxpbms6IFwiL2Jsb2Nrcy9kYi10cmFuc2FjdGlvblwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJSb2xsYmFjayBUcmFuc2FjdGlvblwiLCBsaW5rOiBcIi9ibG9ja3MvZGItcm9sbGJhY2tcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiREIgTmF0aXZlXCIsIGxpbms6IFwiL2Jsb2Nrcy9kYi1uYXRpdmVcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ29uZGl0aW9uc1wiLCBsaW5rOiBcIi9ibG9ja3MvZGItY29uZGl0aW9uc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJKb2luc1wiLCBsaW5rOiBcIi9ibG9ja3MvZGItam9pbnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU29ydGluZyAmIFBhZ2luZ1wiLCBsaW5rOiBcIi9ibG9ja3MvZGItcGFnaW5nLXNvcnRpbmdcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiS2V5LVZhbHVlXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiS1YgT3BlcmF0aW9uc1wiLCBsaW5rOiBcIi9ibG9ja3Mva3Ytb3BlcmF0aW9uc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJLViBSYXcgQ29ubmVjdGlvblwiLCBsaW5rOiBcIi9ibG9ja3Mva3YtcmF3XCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIk1lc3NhZ2UgUXVldWVzXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW3sgdGV4dDogXCJTZW5kIE1lc3NhZ2VcIiwgbGluazogXCIvYmxvY2tzL3NlbmQtbWVzc2FnZVwiIH1dLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJMb2dnaW5nXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ29uc29sZSBMb2dcIiwgbGluazogXCIvYmxvY2tzL2NvbnNvbGUtbG9nXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkNsb3VkIExvZ3NcIiwgbGluazogXCIvYmxvY2tzL2Nsb3VkLWxvZ3NcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiVXRpbGl0eVwiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlRyaWdnZXIgV29ya2Zsb3dcIiwgbGluazogXCIvYmxvY2tzL3RyaWdnZXItd29ya2Zsb3dcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU3RpY2t5IE5vdGVcIiwgbGluazogXCIvYmxvY2tzL3N0aWNreS1ub3RlXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkN1c3RvbSBCbG9ja3NcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9ibG9ja3MvY3VzdG9tLWJsb2Nrc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUdXRvcmlhbFwiLCBsaW5rOiBcIi9ibG9ja3MvY3VzdG9tLWJsb2Nrcy10dXRvcmlhbFwiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cblx0XHRcdFx0XCIvcGx1Z2lucy9cIjogW1xuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiUGx1Z2luc1wiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL3BsdWdpbnMvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkFkZGluZyBhIFBsdWdpblwiLCBsaW5rOiBcIi9wbHVnaW5zL2luc3RhbGxpbmdcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQXBwcm92YWwgJiBQZXJtaXNzaW9uc1wiLCBsaW5rOiBcIi9wbHVnaW5zL2FwcHJvdmluZ1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJVcGdyYWRpbmcgJiBSZW1vdmluZ1wiLCBsaW5rOiBcIi9wbHVnaW5zL3VwZ3JhZGluZ1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJTdGF0dXMgJiBUcm91Ymxlc2hvb3RpbmdcIiwgbGluazogXCIvcGx1Z2lucy9zdGF0dXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQmxvY2tzIG9uIHRoZSBDYW52YXNcIiwgbGluazogXCIvcGx1Z2lucy9ibG9ja3Mtb24tY2FudmFzXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIldyaXRpbmcgUGx1Z2luc1wiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkdldHRpbmcgU3RhcnRlZFwiLCBsaW5rOiBcIi9wbHVnaW5zL2F1dGhvcmluZy9nZXR0aW5nLXN0YXJ0ZWRcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQmxvY2tzXCIsIGxpbms6IFwiL3BsdWdpbnMvYXV0aG9yaW5nL2Jsb2Nrc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJQYXJhbXNcIiwgbGluazogXCIvcGx1Z2lucy9hdXRob3JpbmcvcGFyYW1zXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkhhbmRsZXNcIiwgbGluazogXCIvcGx1Z2lucy9hdXRob3JpbmcvaGFuZGxlc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJDb250ZXh0XCIsIGxpbms6IFwiL3BsdWdpbnMvYXV0aG9yaW5nL2NvbnRleHRcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiSW50ZWdyYXRpb25zXCIsIGxpbms6IFwiL3BsdWdpbnMvYXV0aG9yaW5nL2ludGVncmF0aW9uc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUcmlnZ2Vyc1wiLCBsaW5rOiBcIi9wbHVnaW5zL2F1dGhvcmluZy90cmlnZ2Vyc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUZXN0aW5nXCIsIGxpbms6IFwiL3BsdWdpbnMvYXV0aG9yaW5nL3Rlc3RpbmdcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUHVibGlzaGluZ1wiLCBsaW5rOiBcIi9wbHVnaW5zL2F1dGhvcmluZy9wdWJsaXNoaW5nXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XSxcblxuXHRcdFx0XHRcIi9zY3JpcHRpbmcvXCI6IFtcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIlNjcmlwdGluZ1wiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL3NjcmlwdGluZy9cIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ29udGV4dFwiLCBsaW5rOiBcIi9zY3JpcHRpbmcvY29udGV4dFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJXaGVyZSBZb3VyIENvZGUgUnVuc1wiLCBsaW5rOiBcIi9zY3JpcHRpbmcvZW52aXJvbm1lbnRzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkhvdyBJdCBXb3Jrc1wiLCBsaW5rOiBcIi9zY3JpcHRpbmcvaG93LWl0LXdvcmtzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkphdmFTY3JpcHQgQVBJIFJlZmVyZW5jZVwiLCBsaW5rOiBcIi9zY3JpcHRpbmcvamF2YXNjcmlwdC1hcGlcIiB9LFxuXHRcdFx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHRcdFx0dGV4dDogXCJLZXkgQ29uc2lkZXJhdGlvbnNcIixcblx0XHRcdFx0XHRcdFx0XHRsaW5rOiBcIi9zY3JpcHRpbmcva2V5LWNvbnNpZGVyYXRpb25zXCIsXG5cdFx0XHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJJbXBvcnRzICYgTGlicmFyaWVzXCIsIGxpbms6IFwiL3NjcmlwdGluZy9pbXBvcnRzXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XSxcblxuXHRcdFx0XHRcIi90ZXN0aW5nL1wiOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJUZXN0aW5nXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiT3ZlcnZpZXdcIiwgbGluazogXCIvdGVzdGluZy9cIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiWW91ciBGaXJzdCBUZXN0IFN1aXRlXCIsIGxpbms6IFwiL3Rlc3RpbmcvZmlyc3Qtc3VpdGVcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ2hlY2tpbmcgdGhlIFJlc3BvbnNlXCIsIGxpbms6IFwiL3Rlc3RpbmcvY2hlY2tzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkhvb2tzXCIsIGxpbms6IFwiL3Rlc3RpbmcvaG9va3NcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU2V0dXAgYW5kIFRlYXJkb3duXCIsIGxpbms6IFwiL3Rlc3Rpbmcvc2V0dXAtYW5kLXRlYXJkb3duXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJyaWRlc1wiLCBsaW5rOiBcIi90ZXN0aW5nL292ZXJyaWRlc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUZXN0aW5nIFdvcmtmbG93c1wiLCBsaW5rOiBcIi90ZXN0aW5nL3dvcmtmbG93c1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJSZWFkaW5nIFJlc3VsdHNcIiwgbGluazogXCIvdGVzdGluZy9yZXN1bHRzXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XSxcblxuXHRcdFx0XHRcIi9kZXBsb3ltZW50cy9cIjogW1xuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiRGVwbG95bWVudHNcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJTZWxmLUhvc3RpbmdcIiwgbGluazogXCIvZGVwbG95bWVudHMvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlF1aWNrIFJ1biAoS2l0KVwiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9raXRcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUHJvZHVjdGlvbiAoQWRtaW4gKyBXb3JrZXJzKVwiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9wcm9kdWN0aW9uXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRlcGxveSB3aXRoIGEgQ29kaW5nIEFnZW50XCIsIGxpbms6IFwiL2RlcGxveW1lbnRzL2NvZGluZy1hZ2VudFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJFZGl0aW9uc1wiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9lZGl0aW9uc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJMaWNlbnNlcyAmIENvbnRyaWJ1dGlvbnNcIiwgbGluazogXCIvZGVwbG95bWVudHMvbGljZW5zaW5nXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlNlbGYtU2lnbmVkIExpY2Vuc2VzIChwcmUtMS4wKVwiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9zZWxmLXNpZ25lZC1saWNlbnNlXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkt1YmVybmV0ZXNcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJJbnN0YWxsIG9uIEt1YmVybmV0ZXNcIiwgbGluazogXCIvZGVwbG95bWVudHMva3ViZXJuZXRlcy9pbnN0YWxsXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkNoYXJ0IHNldHRpbmdzXCIsIGxpbms6IFwiL2RlcGxveW1lbnRzL2t1YmVybmV0ZXMvaGVsbS12YWx1ZXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiTG9ncyBhbmQgbW9uaXRvcmluZ1wiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9rdWJlcm5ldGVzL29ic2VydmFiaWxpdHlcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiSG93IGl0IHdvcmtzXCIsIGxpbms6IFwiL2RlcGxveW1lbnRzL2t1YmVybmV0ZXMvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRldmVsb3AgYWdhaW5zdCBhIGxvY2FsIGNsdXN0ZXJcIiwgbGluazogXCIvZGVwbG95bWVudHMva3ViZXJuZXRlcy9sb2NhbFwiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cblx0XHRcdFx0XCIvaW50ZWdyYXRpb25zL1wiOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJJbnRlZ3JhdGlvbnNcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9pbnRlZ3JhdGlvbnMvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkludGVncmF0aW9ucyBmcm9tIFBsdWdpbnNcIiwgbGluazogXCIvaW50ZWdyYXRpb25zL3BsdWdpbi1pbnRlZ3JhdGlvbnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiRGF0YWJhc2VzXCIsIGxpbms6IFwiL2ludGVncmF0aW9ucy9kYXRhYmFzZXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiS1YgU3RvcmVzXCIsIGxpbms6IFwiL2ludGVncmF0aW9ucy9rdi1zdG9yZXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiT2JzZXJ2YWJpbGl0eVwiLCBsaW5rOiBcIi9pbnRlZ3JhdGlvbnMvb2JzZXJ2YWJpbGl0eVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJBSSBNb2RlbHNcIiwgbGluazogXCIvaW50ZWdyYXRpb25zL2FpLW1vZGVsc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUcmFjZSB0aGUgQUkgQXNzaXN0YW50XCIsIGxpbms6IFwiL2ludGVncmF0aW9ucy9hZ2VudC10cmFjaW5nXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk1lc3NhZ2UgUXVldWVzXCIsIGxpbms6IFwiL2ludGVncmF0aW9ucy9tZXNzYWdlLXF1ZXVlc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJNQ1AgU2VydmVyc1wiLCBsaW5rOiBcIi9pbnRlZ3JhdGlvbnMvbWNwLXNlcnZlcnNcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRdLFxuXHRcdFx0fSxcblxuXHRcdFx0Ly8gRWRpdCBsaW5rIHBvaW50aW5nIHRvIHRoZSBHaXRIdWIgc291cmNlXG5cdFx0XHRlZGl0TGluazoge1xuXHRcdFx0XHRwYXR0ZXJuOiBcImh0dHBzOi8vZ2l0aHViLmNvbS9mbHV4aWZ5LXJlc3QvRmx1eGlmeS9lZGl0L21haW4vZG9jcy86cGF0aFwiLFxuXHRcdFx0XHR0ZXh0OiBcIkVkaXQgdGhpcyBwYWdlIG9uIEdpdEh1YlwiLFxuXHRcdFx0fSxcblxuXHRcdFx0Ly8gU29jaWFsIGxpbmtzIGluIHRoZSB0b3AtcmlnaHQgbmF2XG5cdFx0XHRzb2NpYWxMaW5rczogW3sgaWNvbjogXCJnaXRodWJcIiwgbGluazogXCJodHRwczovL2dpdGh1Yi5jb20vZmx1eGlmeS1yZXN0L0ZsdXhpZnlcIiB9XSxcblxuXHRcdFx0Ly8gRm9vdGVyXG5cdFx0XHRmb290ZXI6IHtcblx0XHRcdFx0bWVzc2FnZTpcblx0XHRcdFx0XHRcIlJlbGVhc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSAyLjAuIEVudGVycHJpc2UgZmVhdHVyZXMgYXJlIHVuZGVyIHRoZSBGbHV4aWZ5IEVudGVycHJpc2UgRWRpdGlvbiBMaWNlbnNlLlwiLFxuXHRcdFx0XHRjb3B5cmlnaHQ6IFwiQ29weXJpZ2h0IFx1MDBBOSAyMDI2IEZsdXhpZnlcIixcblx0XHRcdH0sXG5cblx0XHRcdC8vIEJ1aWx0LWluIGxvY2FsIHNlYXJjaCAocmVwbGFjZXMgbWtkb2NzIGBzZWFyY2hgIHBsdWdpbiBcdTIwMTQgbm8gZXh0cmEgY29uZmlnIG5lZWRlZClcblx0XHRcdHNlYXJjaDoge1xuXHRcdFx0XHRwcm92aWRlcjogXCJsb2NhbFwiLFxuXHRcdFx0XHRvcHRpb25zOiB7XG5cdFx0XHRcdFx0Ly8gYWdlbnQgcGFnZXMgc3RheSBvdXQgb2YgdGhlIGh1bWFuIHNlYXJjaCBib3ggKHNlZSBhZ2VudFBhZ2VzKVxuXHRcdFx0XHRcdF9yZW5kZXI6IChzcmMsIGVudiwgbWQpID0+XG5cdFx0XHRcdFx0XHRlbnYucmVsYXRpdmVQYXRoLnN0YXJ0c1dpdGgoXCJhZ2VudHMvXCIpID8gXCJcIiA6IG1kLnJlbmRlcihzcmMsIGVudiksXG5cdFx0XHRcdH0sXG5cdFx0XHR9LFxuXG5cdFx0XHQvLyBPdXRsaW5lICh0YWJsZSBvZiBjb250ZW50cykgXHUyMDE0IG1pcnJvcnMgbWtkb2NzIHRvY19kZXB0aDogM1xuXHRcdFx0b3V0bGluZToge1xuXHRcdFx0XHRsZXZlbDogWzIsIDNdLFxuXHRcdFx0XHRsYWJlbDogXCJPbiBUaGlzIFBhZ2VcIixcblx0XHRcdH0sXG5cblx0XHRcdC8vIFByZXZpb3VzIC8gbmV4dCBwYWdlIGxpbmtzIGF0IHRoZSBib3R0b21cblx0XHRcdGRvY0Zvb3Rlcjoge1xuXHRcdFx0XHRwcmV2OiBcIlByZXZpb3VzXCIsXG5cdFx0XHRcdG5leHQ6IFwiTmV4dFwiLFxuXHRcdFx0fSxcblxuXHRcdFx0bGFzdFVwZGF0ZWQ6IHtcblx0XHRcdFx0dGV4dDogXCJMYXN0IHVwZGF0ZWRcIixcblx0XHRcdH0sXG5cdFx0fSxcblxuXHRcdG1hcmtkb3duOiB7XG5cdFx0XHQvLyBMaW5lIG51bWJlcnMgaW4gY29kZSBibG9ja3Ncblx0XHRcdGxpbmVOdW1iZXJzOiBmYWxzZSxcblx0XHRcdC8vIENvbnRhaW5lciBhbGlhc2VzIHRoYXQgbWFwIG1rZG9jcyBhZG1vbml0aW9uLXN0eWxlIGJsb2Nrczpcblx0XHRcdC8vIFVzZSA6OjogdGlwIC8gOjo6IHdhcm5pbmcgLyA6OjogZGFuZ2VyIC8gOjo6IGluZm8gaW4gbWFya2Rvd24gZmlsZXMuXG5cdFx0fSxcblxuXHRcdHZpdGU6IHtcblx0XHRcdHBsdWdpbnM6IFtcblx0XHRcdFx0Ly8gb3JkZXIgbWF0dGVyczogYm90aCBydW4gYmVmb3JlIGxsbXN0eHQgcmVhZHMgdGhlIHBhZ2Vcblx0XHRcdFx0ZnJvbnRtYXR0ZXJEZWZhdWx0cyhET0NTX0RJUiksXG5cdFx0XHRcdC8vICUlUkVMRUFTRV9UQUclJSAodjAuMS4wKSBhbmQgJSVDSEFSVF9WRVJTSU9OJSUgKDAuMS4wKSBpbiBhbnkgcGFnZSwgY29kZVxuXHRcdFx0XHQvLyBibG9ja3MgaW5jbHVkZWQsIGJlY29tZSB0aGUgbmV3ZXN0IHJlbGVhc2UsIGluIHRoZSBIVE1MIGFuZCB0aGUgbGxtcyBjb3BpZXNcblx0XHRcdFx0e1xuXHRcdFx0XHRcdG5hbWU6IFwiZmx1eGlmeTpyZWxlYXNlLXZlcnNpb25cIixcblx0XHRcdFx0XHRlbmZvcmNlOiBcInByZVwiLFxuXHRcdFx0XHRcdHRyYW5zZm9ybShjb2RlLCBpZCkge1xuXHRcdFx0XHRcdFx0aWYgKCFpZC5lbmRzV2l0aChcIi5tZFwiKSB8fCAhY29kZS5pbmNsdWRlcyhcIiUlXCIpKSByZXR1cm4gbnVsbDtcblx0XHRcdFx0XHRcdHJldHVybiBjb2RlXG5cdFx0XHRcdFx0XHRcdC5yZXBsYWNlQWxsKFwiJSVSRUxFQVNFX1RBRyUlXCIsIHJlbGVhc2VUYWcpXG5cdFx0XHRcdFx0XHRcdC5yZXBsYWNlQWxsKFwiJSVDSEFSVF9WRVJTSU9OJSVcIiwgcmVsZWFzZVRhZy5yZXBsYWNlKC9edi8sIFwiXCIpKTtcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHR9LFxuXHRcdFx0XHQvLyBsbG1zLnR4dCBpbmRleCwgbGxtcy1mdWxsLnR4dCBhbmQgYSAubWQgY29weSBvZiBldmVyeSBwYWdlLCBmb3IgQUkgYWdlbnRzXG5cdFx0XHRcdGxsbXN0eHQoe1xuXHRcdFx0XHRcdGRvbWFpbjogU0lURV9VUkwsXG5cdFx0XHRcdFx0Ly8gZW1wdHkgcGxhY2Vob2xkZXIgcGFnZXMgKHRoZSByZWFsIGNvbnRlbnQgaXMgaW50ZWdyYXRpb25zL2RhdGFiYXNlcy5tZCksIGFuZFxuXHRcdFx0XHRcdC8vIGJsb2cgcG9zdHMsIHdoaWNoIHRoZSBwbHVnaW4ncyBvd24gYmxvZyBwcmVzZXQgbWlzc2VzIHVuZGVyIGJsb2cvcG9zdHMvXG5cdFx0XHRcdFx0aWdub3JlRmlsZXM6IFtcImludGVncmF0aW9ucy9kYXRhYmFzZXMvKlwiLCBcImJsb2cvKipcIl0sXG5cdFx0XHRcdFx0c2lkZWJhcjogbGxtc1NpZGViYXIsXG5cdFx0XHRcdH0pLFxuXHRcdFx0XSxcblx0XHRcdG9wdGltaXplRGVwczoge1xuXHRcdFx0XHQvLyB2aXRlcHJlc3MtcGx1Z2luLW1lcm1haWQgaW5qZWN0cyB0aGUgTWVybWFpZCBjb21wb25lbnQgaW50byBldmVyeVxuXHRcdFx0XHQvLyBwYWdlJ3MgY2xpZW50IGVudHJ5IHZpYSBhIHBvc3QtdHJhbnNmb3JtLCB3aGljaCBWaXRlJ3MgY29sZC1zdGFydFxuXHRcdFx0XHQvLyBkZXBlbmRlbmN5IHNjYW5uZXIgZG9lc24ndCBzZWUuIFdpdGhvdXQgdGhpcywgbWVybWFpZCAoYW5kIGl0c1xuXHRcdFx0XHQvLyBDSlMgYGRheWpzYCBkZXBlbmRlbmN5KSBnZXRzIHNlcnZlZCB1bmJ1bmRsZWQgb24gYSBmcmVzaCBjYWNoZSxcblx0XHRcdFx0Ly8gdGhyb3dpbmcgXCJkb2VzIG5vdCBwcm92aWRlIGFuIGV4cG9ydCBuYW1lZCAnZGVmYXVsdCdcIi5cblx0XHRcdFx0aW5jbHVkZTogW1wibWVybWFpZFwiXSxcblx0XHRcdH0sXG5cdFx0fSxcblx0fSksXG4pO1xuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMveWFzaGFzaF9rdW1hci9mbHV4aWZ5L0ZsdXhpZnkvZG9jcy8udml0ZXByZXNzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMveWFzaGFzaF9rdW1hci9mbHV4aWZ5L0ZsdXhpZnkvZG9jcy8udml0ZXByZXNzL2Zyb250bWF0dGVyRGVmYXVsdHMudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL3lhc2hhc2hfa3VtYXIvZmx1eGlmeS9GbHV4aWZ5L2RvY3MvLnZpdGVwcmVzcy9mcm9udG1hdHRlckRlZmF1bHRzLnRzXCI7aW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW4gfSBmcm9tIFwidml0ZVwiO1xuXG4vKiogUGFnZXMgdGhhdCBhcmUgbm90IGxpc3RlZCBpbiBsbG1zLnR4dCwgc28gdGhleSBuZWVkIG5vIHRpdGxlIG9yIGRlc2NyaXB0aW9uLiAqL1xuY29uc3QgU0tJUCA9IFsvXmluZGV4XFwubWQkLywgL15ibG9nXFwvL107XG5cbi8qKiBWaXRlUHJlc3MgYnVpbGRzIGNsaWVudCBhbmQgc2VydmVyIGJ1bmRsZXMsIHNvIGVhY2ggcGFnZSBwYXNzZXMgdGhyb3VnaCB0d2ljZS4gKi9cbmNvbnN0IHdhcm5lZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4vKiogUGxhaW4gdGV4dCBvZiBhIHBhZ2UgYm9keTogbm8gY29kZSwgaGVhZGluZ3MgbWFya2VycywgbGlua3MsIHRhZ3Mgb3IgbWFya3VwLiAqL1xuZnVuY3Rpb24gcGxhaW5UZXh0KGJvZHk6IHN0cmluZykge1xuXHRyZXR1cm4gYm9keVxuXHRcdC5yZXBsYWNlKC9gYGBbXFxzXFxTXSo/YGBgL2csIFwiIFwiKVxuXHRcdC5yZXBsYWNlKC88W14+XSs+L2csIFwiIFwiKVxuXHRcdC5yZXBsYWNlKC9eOjo6LiokL2dtLCBcIiBcIilcblx0XHQucmVwbGFjZSgvIT9cXFsoW15cXF1dKilcXF1cXChbXildKlxcKS9nLCBcIiQxXCIpXG5cdFx0LnJlcGxhY2UoL14jK1xccy4qJC9nbSwgXCIgXCIpXG5cdFx0LnJlcGxhY2UoL1sqX2A+fF0vZywgXCJcIilcblx0XHQucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcblx0XHQudHJpbSgpO1xufVxuXG4vKipcbiAqIEV2ZXJ5IHBhZ2UgbmVlZHMgYSBgdGl0bGVgIGFuZCBgZGVzY3JpcHRpb25gIGZvciBsbG1zLnR4dC4gQSBtaXNzaW5nIG9uZSBpc1xuICogd2FybmVkIGFib3V0IGFuZCBmaWxsZWQgaW4gXHUyMDE0IHRpdGxlIGZyb20gdGhlIGZpcnN0IGAjIGAgaGVhZGluZyAoZWxzZVxuICogXCJVbnRpdGxlZFwiKSwgZGVzY3JpcHRpb24gdGhlIGZpcnN0IDEwMCBjaGFyYWN0ZXJzIG9mIHRoZSBwYWdlIHRleHQgXHUyMDE0IHNvIHRoZVxuICogYnVpbGQgc3RpbGwgZmluaXNoZXMuXG4gKlxuICogUnVucyBiZWZvcmUgdml0ZXByZXNzLXBsdWdpbi1sbG1zLCB3aGljaCByZWFkcyB0aGUgZnJvbnRtYXR0ZXIgaXQgbGVhdmVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRtYXR0ZXJEZWZhdWx0cyhzcmNEaXI6IHN0cmluZyk6IFBsdWdpbiB7XG5cdHJldHVybiB7XG5cdFx0bmFtZTogXCJmbHV4aWZ5OmZyb250bWF0dGVyLWRlZmF1bHRzXCIsXG5cdFx0ZW5mb3JjZTogXCJwcmVcIixcblx0XHR0cmFuc2Zvcm0oY29kZSwgaWQpIHtcblx0XHRcdGlmICghaWQuZW5kc1dpdGgoXCIubWRcIikpIHJldHVybiBudWxsO1xuXHRcdFx0Y29uc3QgcGFnZSA9IHBhdGgucmVsYXRpdmUoc3JjRGlyLCBpZCkucmVwbGFjZUFsbChcIlxcXFxcIiwgXCIvXCIpO1xuXHRcdFx0aWYgKHBhZ2Uuc3RhcnRzV2l0aChcIi4uXCIpIHx8IFNLSVAuc29tZSgocmUpID0+IHJlLnRlc3QocGFnZSkpKSByZXR1cm4gbnVsbDtcblxuXHRcdFx0Y29uc3QgdGV4dCA9IGNvZGUucmVwbGFjZSgvXFxyXFxuL2csIFwiXFxuXCIpO1xuXHRcdFx0Y29uc3QgbWF0Y2ggPSB0ZXh0Lm1hdGNoKC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tXFxuPy8pO1xuXHRcdFx0Y29uc3QgeWFtbCA9IG1hdGNoPy5bMV0gPz8gXCJcIjtcblx0XHRcdGNvbnN0IGJvZHkgPSBtYXRjaCA/IHRleHQuc2xpY2UobWF0Y2hbMF0ubGVuZ3RoKSA6IHRleHQ7XG5cdFx0XHRpZiAoIWJvZHkudHJpbSgpKSByZXR1cm4gbnVsbDtcblxuXHRcdFx0Y29uc3QgYWRkZWQ6IHN0cmluZ1tdID0gW107XG5cdFx0XHRpZiAoIS9edGl0bGU6L20udGVzdCh5YW1sKSkge1xuXHRcdFx0XHRjb25zdCBoZWFkaW5nID0gYm9keS5tYXRjaCgvXiNcXHMrKC4rKSQvbSk/LlsxXT8udHJpbSgpO1xuXHRcdFx0XHRhZGRlZC5wdXNoKGB0aXRsZTogJHtKU09OLnN0cmluZ2lmeShoZWFkaW5nIHx8IFwiVW50aXRsZWRcIil9YCk7XG5cdFx0XHR9XG5cdFx0XHRpZiAoIS9eZGVzY3JpcHRpb246L20udGVzdCh5YW1sKSkge1xuXHRcdFx0XHRhZGRlZC5wdXNoKGBkZXNjcmlwdGlvbjogJHtKU09OLnN0cmluZ2lmeShwbGFpblRleHQoYm9keSkuc2xpY2UoMCwgMTAwKSl9YCk7XG5cdFx0XHR9XG5cdFx0XHRpZiAoIWFkZGVkLmxlbmd0aCkgcmV0dXJuIG51bGw7XG5cblx0XHRcdGNvbnN0IGZpZWxkcyA9IGFkZGVkLm1hcCgobGluZSkgPT4gbGluZS5zcGxpdChcIjpcIilbMF0pLmpvaW4oXCIgYW5kIFwiKTtcblx0XHRcdGlmICghd2FybmVkLmhhcyhwYWdlKSlcblx0XHRcdFx0Y29uc29sZS53YXJuKGBbZG9jc10gJHtwYWdlfSBoYXMgbm8gJHtmaWVsZHN9IGluIGl0cyBmcm9udG1hdHRlcjsgdXNpbmcgYSBkZWZhdWx0YCk7XG5cdFx0XHR3YXJuZWQuYWRkKHBhZ2UpO1xuXHRcdFx0Y29uc3QgZnJvbnRtYXR0ZXIgPSBbeWFtbCwgLi4uYWRkZWRdLmZpbHRlcihCb29sZWFuKS5qb2luKFwiXFxuXCIpO1xuXHRcdFx0cmV0dXJuIHsgY29kZTogYC0tLVxcbiR7ZnJvbnRtYXR0ZXJ9XFxuLS0tXFxuJHtib2R5fWAsIG1hcDogbnVsbCB9O1xuXHRcdH0sXG5cdH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAi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
