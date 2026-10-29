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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiZG9jcy8udml0ZXByZXNzL2NvbmZpZy50cyIsICJkb2NzLy52aXRlcHJlc3MvZnJvbnRtYXR0ZXJEZWZhdWx0cy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy95YXNoYXNoX2t1bWFyL2ZsdXhpZnkvRmx1eGlmeS9kb2NzLy52aXRlcHJlc3NcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy95YXNoYXNoX2t1bWFyL2ZsdXhpZnkvRmx1eGlmeS9kb2NzLy52aXRlcHJlc3MvY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy95YXNoYXNoX2t1bWFyL2ZsdXhpZnkvRmx1eGlmeS9kb2NzLy52aXRlcHJlc3MvY29uZmlnLnRzXCI7aW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tIFwibm9kZTpjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyByZWFkZGlyU3luYywgcmVhZEZpbGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwibm9kZTp1cmxcIjtcbmltcG9ydCB7IHR5cGUgRGVmYXVsdFRoZW1lLCBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZXByZXNzXCI7XG5pbXBvcnQgbGxtc3R4dCBmcm9tIFwidml0ZXByZXNzLXBsdWdpbi1sbG1zXCI7XG5pbXBvcnQgeyB3aXRoTWVybWFpZCB9IGZyb20gXCJ2aXRlcHJlc3MtcGx1Z2luLW1lcm1haWRcIjtcbmltcG9ydCB7IGZyb250bWF0dGVyRGVmYXVsdHMgfSBmcm9tIFwiLi9mcm9udG1hdHRlckRlZmF1bHRzXCI7XG5cbmNvbnN0IFNJVEVfVVJMID0gXCJodHRwczovL2RvY3MuZmx1eGlmeS5yZXN0XCI7XG5cbi8qKiBTZWN0aW9uIG9yZGVyIGluIGxsbXMudHh0LiBFYWNoIGtleSBpcyBhIHNpZGViYXIgZ3JvdXAgaW4gdGhlIGNvbmZpZyBiZWxvdy4gKi9cbmNvbnN0IExMTVNfU0VDVElPTlMgPSBbXG5cdFwiL2dldHRpbmctc3RhcnRlZC9cIixcblx0XCIvY29uY2VwdHMvXCIsXG5cdFwiL2Jsb2Nrcy9cIixcblx0XCIvcGx1Z2lucy9cIixcblx0XCIvc2NyaXB0aW5nL1wiLFxuXHRcIi90ZXN0aW5nL1wiLFxuXHRcIi9pbnRlZ3JhdGlvbnMvXCIsXG5cdFwiL2RlcGxveW1lbnRzL1wiLFxuXHRcIi9hcmNoaXRlY3R1cmUvXCIsXG5dO1xuXG5jb25zdCBET0NTX0RJUiA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4uXCIsIGltcG9ydC5tZXRhLnVybCkpO1xuXG4vKipcbiAqIGRvY3MvYWdlbnRzLyBpcyB3cml0dGVuIGZvciBBSSBhZ2VudHM6IG5vIHNpZGViYXIgb3IgbmF2IGVudHJ5IGFuZCBsZWZ0IG91dFxuICogb2YgdGhlIHNpdGUgc2VhcmNoLCBidXQgbGlzdGVkIGZpcnN0IGluIGxsbXMudHh0LiBJdHMgcGFnZXMgYXJlIHJlYWQgZnJvbVxuICogZGlzaywgc28gYSBuZXcgb25lIG5lZWRzIG5vIGNvbmZpZyBjaGFuZ2UuIFRpdGxlcyBjb21lIGZyb20gZnJvbnRtYXR0ZXIuXG4gKi9cbmZ1bmN0aW9uIGFnZW50UGFnZXMoKTogRGVmYXVsdFRoZW1lLlNpZGViYXJJdGVtW10ge1xuXHRyZXR1cm4gcmVhZGRpclN5bmMoYCR7RE9DU19ESVJ9YWdlbnRzYCwgeyByZWN1cnNpdmU6IHRydWUgfSlcblx0XHQubWFwKChmKSA9PiBmLnRvU3RyaW5nKCkucmVwbGFjZUFsbChcIlxcXFxcIiwgXCIvXCIpKVxuXHRcdC5maWx0ZXIoKGYpID0+IGYuZW5kc1dpdGgoXCIubWRcIikpXG5cdFx0LnNvcnQoKGEsIGIpID0+IE51bWJlcihiID09PSBcImluZGV4Lm1kXCIpIC0gTnVtYmVyKGEgPT09IFwiaW5kZXgubWRcIikgfHwgYS5sb2NhbGVDb21wYXJlKGIpKVxuXHRcdC5tYXAoKGYpID0+IHtcblx0XHRcdGNvbnN0IHRleHQgPSByZWFkRmlsZVN5bmMoYCR7RE9DU19ESVJ9YWdlbnRzLyR7Zn1gLCBcInV0ZjhcIik7XG5cdFx0XHRjb25zdCB0aXRsZSA9IHRleHQubWF0Y2goL150aXRsZTpcXHMqW1wiJ10/KC4rPylbXCInXT9cXHMqJC9tKT8uWzFdID8/IGY7XG5cdFx0XHRyZXR1cm4geyB0ZXh0OiB0aXRsZSwgbGluazogYC9hZ2VudHMvJHtmLnJlcGxhY2UoLyhpbmRleCk/XFwubWQkLywgXCJcIil9YCB9O1xuXHRcdH0pO1xufVxuXG4vKiogVGhlIHNpZGViYXIgaW4gbGxtcy50eHQgb3JkZXIsIHBsdXMgcGFnZXMgdGhhdCBoYXZlIG5vIHNpZGViYXIgb2YgdGhlaXIgb3duLiAqL1xuZnVuY3Rpb24gbGxtc1NpZGViYXIoc2lkZWJhcjogRGVmYXVsdFRoZW1lLlNpZGViYXIgfCB1bmRlZmluZWQpIHtcblx0Y29uc3QgZ3JvdXBzID0gKHNpZGViYXIgPz8ge30pIGFzIERlZmF1bHRUaGVtZS5TaWRlYmFyTXVsdGk7XG5cdHJldHVybiBbXG5cdFx0eyB0ZXh0OiBcIkZvciBBSSBBZ2VudHMgKHJlYWQgZmlyc3QpXCIsIGl0ZW1zOiBhZ2VudFBhZ2VzKCkgfSxcblx0XHQuLi5MTE1TX1NFQ1RJT05TLmZsYXRNYXAoKGtleSkgPT4gZ3JvdXBzW2tleV0gPz8gW10pLFxuXHRcdHtcblx0XHRcdHRleHQ6IFwiRGV2ZWxvcG1lbnRcIixcblx0XHRcdGl0ZW1zOiBbeyB0ZXh0OiBcIm5wbSBQYWNrYWdlc1wiLCBsaW5rOiBcIi9kZXZlbG9wbWVudC9ucG0tcGFja2FnZXNcIiB9XSxcblx0XHR9LFxuXHRdIGFzIERlZmF1bHRUaGVtZS5TaWRlYmFySXRlbVtdO1xufVxuXG4vKipcbiAqIFRoZSBuZXdlc3QgcmVsZWFzZSwgcHJlLXJlbGVhc2VzIGluY2x1ZGVkLCBzbyBpbnN0YWxsIGNvbW1hbmRzIGNhbiBiZVxuICogY29waWVkIGFzIHRoZXkgYXJlLiBDSSBwYXNzZXMgaXQgaW47IGEgbG9jYWwgYnVpbGQgcmVhZHMgdGhlIG5ld2VzdCB0YWcuXG4gKi9cbmZ1bmN0aW9uIGxhdGVzdFJlbGVhc2UoKTogc3RyaW5nIHtcblx0aWYgKHByb2Nlc3MuZW52LkZMVVhJRllfUkVMRUFTRV9UQUcpIHJldHVybiBwcm9jZXNzLmVudi5GTFVYSUZZX1JFTEVBU0VfVEFHO1xuXHR0cnkge1xuXHRcdGNvbnN0IHRhZ3MgPSBleGVjU3luYyhcImdpdCB0YWcgLS1saXN0IHYqIC0tc29ydD0tY3JlYXRvcmRhdGVcIiwgeyBlbmNvZGluZzogXCJ1dGY4XCIgfSk7XG5cdFx0cmV0dXJuIHRhZ3Muc3BsaXQoXCJcXG5cIilbMF0gfHwgXCJ2MC4wLjBcIjtcblx0fSBjYXRjaCB7XG5cdFx0cmV0dXJuIFwidjAuMC4wXCI7XG5cdH1cbn1cbmNvbnN0IHJlbGVhc2VUYWcgPSBsYXRlc3RSZWxlYXNlKCk7XG5cbi8vIHdpdGhNZXJtYWlkIHdyYXBzIHRoZSBjb25maWcgc28gYGBgbWVybWFpZCBjb2RlIGZlbmNlcyByZW5kZXIgYXMgZGlhZ3JhbXMuXG4vLyBodHRwczovL3ZpdGVwcmVzcy5kZXYvcmVmZXJlbmNlL3NpdGUtY29uZmlnXG5leHBvcnQgZGVmYXVsdCB3aXRoTWVybWFpZChcblx0ZGVmaW5lQ29uZmlnKHtcblx0XHR0aXRsZTogXCJGbHV4aWZ5XCIsXG5cdFx0ZGVzY3JpcHRpb246XG5cdFx0XHRcIkRyYXcgeW91ciBiYWNrZW5kLiBTaGlwIGl0IGFzIGNvZGUuIEEgbG93LWNvZGUgcGxhdGZvcm0gdG8gYnVpbGQgQVBJcyBhbmQgYmFja2dyb3VuZCBqb2JzIHZpc3VhbGx5LlwiLFxuXHRcdGxhbmc6IFwiZW4tVVNcIixcblxuXHRcdC8vIFRoZSBkb2NzIGxpdmUgaW4gdGhlIHJlcG8gcm9vdCAvZG9jcyBkaXJlY3RvcnksIHNvIG5vIHNyY0RpciBuZWVkZWQuXG5cdFx0Ly8gU2l0ZSBpcyBkZXBsb3llZCBhdCBodHRwczovL2RvY3MuZmx1eGlmeS5yZXN0XG5cdFx0YmFzZTogXCIvXCIsXG5cblx0XHQvLyBXYXJuIG9uIGRlYWQgbGlua3MgYnV0IGRvbid0IGZhaWwgdGhlIGJ1aWxkIGZvciBwcmUtZXhpc3RpbmcgaXNzdWVzXG5cdFx0aWdub3JlRGVhZExpbmtzOiB0cnVlLFxuXG5cdFx0Ly8gQWJzb2x1dGUgcGFnZSBVUkxzLCBmb3Igc2l0ZW1hcC54bWxcblx0XHRzaXRlbWFwOiB7IGhvc3RuYW1lOiBTSVRFX1VSTCB9LFxuXG5cdFx0aGVhZDogW1xuXHRcdFx0W1wibGlua1wiLCB7IHJlbDogXCJpY29uXCIsIHR5cGU6IFwiaW1hZ2UveC1pY29uXCIsIGhyZWY6IFwiL2Fzc2V0cy9mYXZpY29uLmljb1wiIH1dLFxuXHRcdFx0W1wibGlua1wiLCB7IHJlbDogXCJpY29uXCIsIHR5cGU6IFwiaW1hZ2UvcG5nXCIsIGhyZWY6IFwiL2Fzc2V0cy9sb2dvLnBuZ1wiIH1dLFxuXHRcdFx0W1wibWV0YVwiLCB7IG5hbWU6IFwidGhlbWUtY29sb3JcIiwgY29udGVudDogXCIjMDAwMDAwXCIgfV0sXG5cdFx0XSxcblxuXHRcdC8vIFNvdXJjZSBtYXJrZG93biBsaXZlcyBpbiBkb2NzLywgY29uZmlnIGlzIGluIGRvY3MvLnZpdGVwcmVzcy9cblx0XHQvLyBWaXRlUHJlc3MgcGlja3MgdGhpcyB1cCBhdXRvbWF0aWNhbGx5IHdoZW4gcnVuIGFzIGB2aXRlcHJlc3MgZGV2IGRvY3NgXG5cblx0XHR0aGVtZUNvbmZpZzoge1xuXHRcdFx0Ly8gaHR0cHM6Ly92aXRlcHJlc3MuZGV2L3JlZmVyZW5jZS9kZWZhdWx0LXRoZW1lLWNvbmZpZ1xuXHRcdFx0bG9nbzogXCIvYXNzZXRzL2xvZ28ucG5nXCIsXG5cdFx0XHRzaXRlVGl0bGU6IFwiRmx1eGlmeVwiLFxuXG5cdFx0XHRuYXY6IFtcblx0XHRcdFx0eyB0ZXh0OiBcIkdldHRpbmcgU3RhcnRlZFwiLCBsaW5rOiBcIi9nZXR0aW5nLXN0YXJ0ZWQvXCIgfSxcblx0XHRcdFx0e1xuXHRcdFx0XHRcdHRleHQ6IFwiQ29uY2VwdHNcIixcblx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL2NvbmNlcHRzL1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiQXBwIENvbmZpZ1wiLCBsaW5rOiBcIi9jb25jZXB0cy9hcHAtY29uZmlnXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJBdWRpdCBMb2dzXCIsIGxpbms6IFwiL2NvbmNlcHRzL2F1ZGl0LWxvZ3NcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkJsb2Nrc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9ibG9ja3NcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkVkZ2VzXCIsIGxpbms6IFwiL2NvbmNlcHRzL2VkZ2VzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJFbnZpcm9ubWVudHNcIiwgbGluazogXCIvY29uY2VwdHMvZW52aXJvbm1lbnRzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJFeGVjdXRpb24gQ29udGV4dFwiLCBsaW5rOiBcIi9jb25jZXB0cy9jb250ZXh0XCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJFeGVjdXRpb24gRW5naW5lXCIsIGxpbms6IFwiL2NvbmNlcHRzL2V4ZWN1dGlvbi1lbmdpbmVcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkV4ZWN1dGlvbiBSZWNvcmRpbmdcIiwgbGluazogXCIvY29uY2VwdHMvZXhlY3V0aW9uLXJlY29yZGluZ1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiR2xvYmFsc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9nbG9iYWxzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJIVFRQIENsaWVudFwiLCBsaW5rOiBcIi9jb25jZXB0cy9odHRwLWNsaWVudFwiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiRXZhbHVhdG9yc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9ldmFsdWF0b3JzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJNaWRkbGV3YXJlc1wiLCBsaW5rOiBcIi9jb25jZXB0cy9taWRkbGV3YXJlc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiU2FuZGJveFwiLCBsaW5rOiBcIi9jb25jZXB0cy9zYW5kYm94XCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJXb3JrZmxvd3NcIiwgbGluazogXCIvY29uY2VwdHMvd29ya2Zsb3dzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJUcmlnZ2Vyc1wiLCBsaW5rOiBcIi9jb25jZXB0cy90cmlnZ2Vyc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiU2NoZWR1bGVzXCIsIGxpbms6IFwiL2NvbmNlcHRzL3NjaGVkdWxlc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiVGVsZW1ldHJ5IENvbmZpZ3VyYXRpb25cIiwgbGluazogXCIvY29uY2VwdHMvdGVsZW1ldHJ5LWNvbmZpZ3VyYXRpb25cIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlZlcnNpb25pbmdcIiwgbGluazogXCIvY29uY2VwdHMvdmVyc2lvbmluZ1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiQXJjaGl0ZWN0dXJlXCIsIGxpbms6IFwiL2FyY2hpdGVjdHVyZS9cIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkludGVncmF0aW9uc1wiLCBsaW5rOiBcIi9pbnRlZ3JhdGlvbnMvXCIgfSxcblx0XHRcdFx0XHRdLFxuXHRcdFx0XHR9LFxuXHRcdFx0XHR7XG5cdFx0XHRcdFx0dGV4dDogXCJCbG9ja3NcIixcblx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL2Jsb2Nrcy9cIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkhvdyBUaGV5IFdvcmtcIiwgbGluazogXCIvYmxvY2tzL2hvdy10aGV5LXdvcmtcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkxpc3Qgb2YgQmxvY2tzXCIsIGxpbms6IFwiL2Jsb2Nrcy9saXN0LW9mLWJsb2Nrc1wiIH0sXG5cdFx0XHRcdFx0XSxcblx0XHRcdFx0fSxcblx0XHRcdFx0e1xuXHRcdFx0XHRcdHRleHQ6IFwiUGx1Z2luc1wiLFxuXHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiT3ZlcnZpZXdcIiwgbGluazogXCIvcGx1Z2lucy9cIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkFkZGluZyBhIFBsdWdpblwiLCBsaW5rOiBcIi9wbHVnaW5zL2luc3RhbGxpbmdcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkFwcHJvdmFsICYgUGVybWlzc2lvbnNcIiwgbGluazogXCIvcGx1Z2lucy9hcHByb3ZpbmdcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlVwZ3JhZGluZyAmIFJlbW92aW5nXCIsIGxpbms6IFwiL3BsdWdpbnMvdXBncmFkaW5nXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJTdGF0dXMgJiBUcm91Ymxlc2hvb3RpbmdcIiwgbGluazogXCIvcGx1Z2lucy9zdGF0dXNcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkJsb2NrcyBvbiB0aGUgQ2FudmFzXCIsIGxpbms6IFwiL3BsdWdpbnMvYmxvY2tzLW9uLWNhbnZhc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiV3JpdGluZyBhIFBsdWdpblwiLCBsaW5rOiBcIi9wbHVnaW5zL2F1dGhvcmluZy9nZXR0aW5nLXN0YXJ0ZWRcIiB9LFxuXHRcdFx0XHRcdF0sXG5cdFx0XHRcdH0sXG5cdFx0XHRcdHtcblx0XHRcdFx0XHR0ZXh0OiBcIlNjcmlwdGluZ1wiLFxuXHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiT3ZlcnZpZXdcIiwgbGluazogXCIvc2NyaXB0aW5nL1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ29udGV4dFwiLCBsaW5rOiBcIi9zY3JpcHRpbmcvY29udGV4dFwiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiV2hlcmUgWW91ciBDb2RlIFJ1bnNcIiwgbGluazogXCIvc2NyaXB0aW5nL2Vudmlyb25tZW50c1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiSG93IEl0IFdvcmtzXCIsIGxpbms6IFwiL3NjcmlwdGluZy9ob3ctaXQtd29ya3NcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkphdmFTY3JpcHQgQVBJIFJlZmVyZW5jZVwiLCBsaW5rOiBcIi9zY3JpcHRpbmcvamF2YXNjcmlwdC1hcGlcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIktleSBDb25zaWRlcmF0aW9uc1wiLCBsaW5rOiBcIi9zY3JpcHRpbmcva2V5LWNvbnNpZGVyYXRpb25zXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJJbXBvcnRzICYgTGlicmFyaWVzXCIsIGxpbms6IFwiL3NjcmlwdGluZy9pbXBvcnRzXCIgfSxcblx0XHRcdFx0XHRdLFxuXHRcdFx0XHR9LFxuXHRcdFx0XHR7XG5cdFx0XHRcdFx0dGV4dDogXCJUZXN0aW5nXCIsXG5cdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi90ZXN0aW5nL1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiWW91ciBGaXJzdCBUZXN0IFN1aXRlXCIsIGxpbms6IFwiL3Rlc3RpbmcvZmlyc3Qtc3VpdGVcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkNoZWNraW5nIHRoZSBSZXNwb25zZVwiLCBsaW5rOiBcIi90ZXN0aW5nL2NoZWNrc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiSG9va3NcIiwgbGluazogXCIvdGVzdGluZy9ob29rc1wiIH0sXG5cdFx0XHRcdFx0XHR7IHRleHQ6IFwiU2V0dXAgYW5kIFRlYXJkb3duXCIsIGxpbms6IFwiL3Rlc3Rpbmcvc2V0dXAtYW5kLXRlYXJkb3duXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVycmlkZXNcIiwgbGluazogXCIvdGVzdGluZy9vdmVycmlkZXNcIiB9LFxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlRlc3RpbmcgV29ya2Zsb3dzXCIsIGxpbms6IFwiL3Rlc3Rpbmcvd29ya2Zsb3dzXCIgfSxcblx0XHRcdFx0XHRcdHsgdGV4dDogXCJSZWFkaW5nIFJlc3VsdHNcIiwgbGluazogXCIvdGVzdGluZy9yZXN1bHRzXCIgfSxcblx0XHRcdFx0XHRdLFxuXHRcdFx0XHR9LFxuXHRcdFx0XHR7IHRleHQ6IFwiRGVwbG95bWVudHNcIiwgbGluazogXCIvZGVwbG95bWVudHMvXCIgfSxcblx0XHRcdF0sXG5cblx0XHRcdHNpZGViYXI6IHtcblx0XHRcdFx0XCIvZ2V0dGluZy1zdGFydGVkL1wiOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJHZXR0aW5nIFN0YXJ0ZWRcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9nZXR0aW5nLXN0YXJ0ZWQvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkd1aWRlXCIsIGxpbms6IFwiL2dldHRpbmctc3RhcnRlZC9iYXNpY3NcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUm91dGluZyAmIFZhbGlkYXRpb25cIiwgbGluazogXCIvZ2V0dGluZy1zdGFydGVkL3JvdXRpbmdcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ29ubmVjdCBhbiBBSSBBZ2VudFwiLCBsaW5rOiBcIi9nZXR0aW5nLXN0YXJ0ZWQvYWktYWdlbnRzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkN1c3RvbSBLbm93bGVkZ2UgQmFzZVwiLCBsaW5rOiBcIi9nZXR0aW5nLXN0YXJ0ZWQva25vd2xlZGdlLWJhc2VcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ29udHJpYnV0aW5nXCIsIGxpbms6IFwiL2dldHRpbmctc3RhcnRlZC9jb250cmlidXRpbmdcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiTG9jYWwgVGVzdGluZ1wiLCBsaW5rOiBcIi9nZXR0aW5nLXN0YXJ0ZWQvbG9jYWwtdGVzdGluZ1wiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cblx0XHRcdFx0XCIvYXJjaGl0ZWN0dXJlL1wiOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJBcmNoaXRlY3R1cmVcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9hcmNoaXRlY3R1cmUvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlJlcXVlc3QgTGlmZWN5Y2xlXCIsIGxpbms6IFwiL2FyY2hpdGVjdHVyZS9yZXF1ZXN0LWxpZmVjeWNsZVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUaGUgT3JjaGVzdHJhdG9yXCIsIGxpbms6IFwiL2FyY2hpdGVjdHVyZS9vcmNoZXN0cmF0b3JcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUGVyZm9ybWFuY2VcIiwgbGluazogXCIvYXJjaGl0ZWN0dXJlL3BlcmZvcm1hbmNlXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XSxcblxuXHRcdFx0XHRcIi9jb25jZXB0cy9cIjogW1xuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiQ29uY2VwdHNcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9jb25jZXB0cy9cIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQXBwIENvbmZpZ1wiLCBsaW5rOiBcIi9jb25jZXB0cy9hcHAtY29uZmlnXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkF1ZGl0IExvZ3NcIiwgbGluazogXCIvY29uY2VwdHMvYXVkaXQtbG9nc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJCbG9ja3NcIiwgbGluazogXCIvY29uY2VwdHMvYmxvY2tzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkVkZ2VzXCIsIGxpbms6IFwiL2NvbmNlcHRzL2VkZ2VzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkVudmlyb25tZW50c1wiLCBsaW5rOiBcIi9jb25jZXB0cy9lbnZpcm9ubWVudHNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiRXhlY3V0aW9uIENvbnRleHRcIiwgbGluazogXCIvY29uY2VwdHMvY29udGV4dFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJFeGVjdXRpb24gRW5naW5lXCIsIGxpbms6IFwiL2NvbmNlcHRzL2V4ZWN1dGlvbi1lbmdpbmVcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiRXhlY3V0aW9uIFJlY29yZGluZ1wiLCBsaW5rOiBcIi9jb25jZXB0cy9leGVjdXRpb24tcmVjb3JkaW5nXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkdsb2JhbHNcIiwgbGluazogXCIvY29uY2VwdHMvZ2xvYmFsc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJIVFRQIENsaWVudFwiLCBsaW5rOiBcIi9jb25jZXB0cy9odHRwLWNsaWVudFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJFdmFsdWF0b3JzXCIsIGxpbms6IFwiL2NvbmNlcHRzL2V2YWx1YXRvcnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiTWlkZGxld2FyZXNcIiwgbGluazogXCIvY29uY2VwdHMvbWlkZGxld2FyZXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU2FuZGJveFwiLCBsaW5rOiBcIi9jb25jZXB0cy9zYW5kYm94XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIldvcmtmbG93c1wiLCBsaW5rOiBcIi9jb25jZXB0cy93b3JrZmxvd3NcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiVHJpZ2dlcnNcIiwgbGluazogXCIvY29uY2VwdHMvdHJpZ2dlcnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU2NoZWR1bGVzXCIsIGxpbms6IFwiL2NvbmNlcHRzL3NjaGVkdWxlc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUZWxlbWV0cnkgQ29uZmlndXJhdGlvblwiLCBsaW5rOiBcIi9jb25jZXB0cy90ZWxlbWV0cnktY29uZmlndXJhdGlvblwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJWZXJzaW9uaW5nXCIsIGxpbms6IFwiL2NvbmNlcHRzL3ZlcnNpb25pbmdcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRdLFxuXG5cdFx0XHRcdFwiL2Jsb2Nrcy9cIjogW1xuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiQmxvY2tzXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiT3ZlcnZpZXdcIiwgbGluazogXCIvYmxvY2tzL1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJIb3cgVGhleSBXb3JrXCIsIGxpbms6IFwiL2Jsb2Nrcy9ob3ctdGhleS13b3JrXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkxpc3Qgb2YgQmxvY2tzXCIsIGxpbms6IFwiL2Jsb2Nrcy9saXN0LW9mLWJsb2Nrc1wiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJMb2dpYyAmIEZsb3dcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJFbnRyeXBvaW50XCIsIGxpbms6IFwiL2Jsb2Nrcy9lbnRyeXBvaW50XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIklmIENvbmRpdGlvblwiLCBsaW5rOiBcIi9ibG9ja3MvaWYtY29uZGl0aW9uXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlN3aXRjaFwiLCBsaW5rOiBcIi9ibG9ja3Mvc3dpdGNoXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkZvciBMb29wXCIsIGxpbms6IFwiL2Jsb2Nrcy9mb3ItbG9vcFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJGb3IgRWFjaCBMb29wXCIsIGxpbms6IFwiL2Jsb2Nrcy9mb3JlYWNoLWxvb3BcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiT3JjaGVzdHJhdG9yXCIsIGxpbms6IFwiL2Jsb2Nrcy9vcmNoZXN0cmF0b3JcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUmV0cnlcIiwgbGluazogXCIvYmxvY2tzL3JldHJ5XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkVycm9yIEhhbmRsZXJcIiwgbGluazogXCIvYmxvY2tzL2Vycm9yLWhhbmRsZXJcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUmVzcG9uc2VcIiwgbGluazogXCIvYmxvY2tzL3Jlc3BvbnNlXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkRhdGFcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJTZXQgVmFyaWFibGVcIiwgbGluazogXCIvYmxvY2tzL3NldC12YXJcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiR2V0IFZhcmlhYmxlXCIsIGxpbms6IFwiL2Jsb2Nrcy9nZXQtdmFyXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkFycmF5IE9wZXJhdGlvbnNcIiwgbGluazogXCIvYmxvY2tzL2FycmF5LW9wZXJhdGlvbnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiVHJhbnNmb3JtZXJcIiwgbGluazogXCIvYmxvY2tzL3RyYW5zZm9ybWVyXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkpTIFJ1bm5lclwiLCBsaW5rOiBcIi9ibG9ja3MvanMtcnVubmVyXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkpTIFJ1bm5lciBFeGFtcGxlc1wiLCBsaW5rOiBcIi9ibG9ja3MvanMtcnVubmVyLWV4YW1wbGVzXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkhUVFBcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJIVFRQIFJlcXVlc3RcIiwgbGluazogXCIvYmxvY2tzL2h0dHAtcmVxdWVzdFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJHZXQgUXVlcnkvUGF0aCBQYXJhbVwiLCBsaW5rOiBcIi9ibG9ja3MvZ2V0LWh0dHAtcGFyYW1cIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiR2V0IEhlYWRlclwiLCBsaW5rOiBcIi9ibG9ja3MvZ2V0LWh0dHAtaGVhZGVyXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkdldCBSZXF1ZXN0IEJvZHlcIiwgbGluazogXCIvYmxvY2tzL2dldC1odHRwLXJlcXVlc3QtYm9keVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJTZXQgSFRUUCBIZWFkZXJcIiwgbGluazogXCIvYmxvY2tzL3NldC1odHRwLWhlYWRlclwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJHZXQgQ29va2llXCIsIGxpbms6IFwiL2Jsb2Nrcy9nZXQtcmVxdWVzdC1jb29raWVcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU2V0IENvb2tpZVwiLCBsaW5rOiBcIi9ibG9ja3Mvc2V0LWh0dHAtY29va2llXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkRhdGFiYXNlXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiREIgR2V0IEFsbFwiLCBsaW5rOiBcIi9ibG9ja3MvZGItZ2V0LWFsbFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJEQiBHZXQgU2luZ2xlXCIsIGxpbms6IFwiL2Jsb2Nrcy9kYi1nZXQtc2luZ2xlXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRCIFJvdyBFeGlzdHNcIiwgbGluazogXCIvYmxvY2tzL2RiLXJvdy1leGlzdHNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiREIgQ291bnRcIiwgbGluazogXCIvYmxvY2tzL2RiLWNvdW50XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRCIEluc2VydFwiLCBsaW5rOiBcIi9ibG9ja3MvZGItaW5zZXJ0XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRCIEluc2VydCBCdWxrXCIsIGxpbms6IFwiL2Jsb2Nrcy9kYi1pbnNlcnQtYnVsa1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJEQiBVcGRhdGVcIiwgbGluazogXCIvYmxvY2tzL2RiLXVwZGF0ZVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJEQiBEZWxldGVcIiwgbGluazogXCIvYmxvY2tzL2RiLWRlbGV0ZVwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJEQiBUcmFuc2FjdGlvblwiLCBsaW5rOiBcIi9ibG9ja3MvZGItdHJhbnNhY3Rpb25cIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUm9sbGJhY2sgVHJhbnNhY3Rpb25cIiwgbGluazogXCIvYmxvY2tzL2RiLXJvbGxiYWNrXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRCIE5hdGl2ZVwiLCBsaW5rOiBcIi9ibG9ja3MvZGItbmF0aXZlXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkNvbmRpdGlvbnNcIiwgbGluazogXCIvYmxvY2tzL2RiLWNvbmRpdGlvbnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiSm9pbnNcIiwgbGluazogXCIvYmxvY2tzL2RiLWpvaW5zXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlNvcnRpbmcgJiBQYWdpbmdcIiwgbGluazogXCIvYmxvY2tzL2RiLXBhZ2luZy1zb3J0aW5nXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIktleS1WYWx1ZVwiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIktWIE9wZXJhdGlvbnNcIiwgbGluazogXCIvYmxvY2tzL2t2LW9wZXJhdGlvbnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiS1YgUmF3IENvbm5lY3Rpb25cIiwgbGluazogXCIvYmxvY2tzL2t2LXJhd1wiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJNZXNzYWdlIFF1ZXVlc1wiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFt7IHRleHQ6IFwiU2VuZCBNZXNzYWdlXCIsIGxpbms6IFwiL2Jsb2Nrcy9zZW5kLW1lc3NhZ2VcIiB9XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiTG9nZ2luZ1wiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkNvbnNvbGUgTG9nXCIsIGxpbms6IFwiL2Jsb2Nrcy9jb25zb2xlLWxvZ1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJDbG91ZCBMb2dzXCIsIGxpbms6IFwiL2Jsb2Nrcy9jbG91ZC1sb2dzXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIlV0aWxpdHlcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUcmlnZ2VyIFdvcmtmbG93XCIsIGxpbms6IFwiL2Jsb2Nrcy90cmlnZ2VyLXdvcmtmbG93XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlN0aWNreSBOb3RlXCIsIGxpbms6IFwiL2Jsb2Nrcy9zdGlja3ktbm90ZVwiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJDdXN0b20gQmxvY2tzXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiT3ZlcnZpZXdcIiwgbGluazogXCIvYmxvY2tzL2N1c3RvbS1ibG9ja3NcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiVHV0b3JpYWxcIiwgbGluazogXCIvYmxvY2tzL2N1c3RvbS1ibG9ja3MtdHV0b3JpYWxcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRdLFxuXG5cdFx0XHRcdFwiL3BsdWdpbnMvXCI6IFtcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIlBsdWdpbnNcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9wbHVnaW5zL1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJBZGRpbmcgYSBQbHVnaW5cIiwgbGluazogXCIvcGx1Z2lucy9pbnN0YWxsaW5nXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkFwcHJvdmFsICYgUGVybWlzc2lvbnNcIiwgbGluazogXCIvcGx1Z2lucy9hcHByb3ZpbmdcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiVXBncmFkaW5nICYgUmVtb3ZpbmdcIiwgbGluazogXCIvcGx1Z2lucy91cGdyYWRpbmdcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU3RhdHVzICYgVHJvdWJsZXNob290aW5nXCIsIGxpbms6IFwiL3BsdWdpbnMvc3RhdHVzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkJsb2NrcyBvbiB0aGUgQ2FudmFzXCIsIGxpbms6IFwiL3BsdWdpbnMvYmxvY2tzLW9uLWNhbnZhc1wiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJXcml0aW5nIFBsdWdpbnNcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJHZXR0aW5nIFN0YXJ0ZWRcIiwgbGluazogXCIvcGx1Z2lucy9hdXRob3JpbmcvZ2V0dGluZy1zdGFydGVkXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkJsb2Nrc1wiLCBsaW5rOiBcIi9wbHVnaW5zL2F1dGhvcmluZy9ibG9ja3NcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUGFyYW1zXCIsIGxpbms6IFwiL3BsdWdpbnMvYXV0aG9yaW5nL3BhcmFtc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJIYW5kbGVzXCIsIGxpbms6IFwiL3BsdWdpbnMvYXV0aG9yaW5nL2hhbmRsZXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQ29udGV4dFwiLCBsaW5rOiBcIi9wbHVnaW5zL2F1dGhvcmluZy9jb250ZXh0XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkludGVncmF0aW9uc1wiLCBsaW5rOiBcIi9wbHVnaW5zL2F1dGhvcmluZy9pbnRlZ3JhdGlvbnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiVHJpZ2dlcnNcIiwgbGluazogXCIvcGx1Z2lucy9hdXRob3JpbmcvdHJpZ2dlcnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiVGVzdGluZ1wiLCBsaW5rOiBcIi9wbHVnaW5zL2F1dGhvcmluZy90ZXN0aW5nXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlB1Ymxpc2hpbmdcIiwgbGluazogXCIvcGx1Z2lucy9hdXRob3JpbmcvcHVibGlzaGluZ1wiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cblx0XHRcdFx0XCIvc2NyaXB0aW5nL1wiOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJTY3JpcHRpbmdcIixcblx0XHRcdFx0XHRcdGl0ZW1zOiBbXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVydmlld1wiLCBsaW5rOiBcIi9zY3JpcHRpbmcvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkNvbnRleHRcIiwgbGluazogXCIvc2NyaXB0aW5nL2NvbnRleHRcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiV2hlcmUgWW91ciBDb2RlIFJ1bnNcIiwgbGluazogXCIvc2NyaXB0aW5nL2Vudmlyb25tZW50c1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJIb3cgSXQgV29ya3NcIiwgbGluazogXCIvc2NyaXB0aW5nL2hvdy1pdC13b3Jrc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJKYXZhU2NyaXB0IEFQSSBSZWZlcmVuY2VcIiwgbGluazogXCIvc2NyaXB0aW5nL2phdmFzY3JpcHQtYXBpXCIgfSxcblx0XHRcdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0XHRcdHRleHQ6IFwiS2V5IENvbnNpZGVyYXRpb25zXCIsXG5cdFx0XHRcdFx0XHRcdFx0bGluazogXCIvc2NyaXB0aW5nL2tleS1jb25zaWRlcmF0aW9uc1wiLFxuXHRcdFx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiSW1wb3J0cyAmIExpYnJhcmllc1wiLCBsaW5rOiBcIi9zY3JpcHRpbmcvaW1wb3J0c1wiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cblx0XHRcdFx0XCIvdGVzdGluZy9cIjogW1xuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiVGVzdGluZ1wiLFxuXHRcdFx0XHRcdFx0aXRlbXM6IFtcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk92ZXJ2aWV3XCIsIGxpbms6IFwiL3Rlc3RpbmcvXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIllvdXIgRmlyc3QgVGVzdCBTdWl0ZVwiLCBsaW5rOiBcIi90ZXN0aW5nL2ZpcnN0LXN1aXRlXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkNoZWNraW5nIHRoZSBSZXNwb25zZVwiLCBsaW5rOiBcIi90ZXN0aW5nL2NoZWNrc1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJIb29rc1wiLCBsaW5rOiBcIi90ZXN0aW5nL2hvb2tzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlNldHVwIGFuZCBUZWFyZG93blwiLCBsaW5rOiBcIi90ZXN0aW5nL3NldHVwLWFuZC10ZWFyZG93blwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJPdmVycmlkZXNcIiwgbGluazogXCIvdGVzdGluZy9vdmVycmlkZXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiVGVzdGluZyBXb3JrZmxvd3NcIiwgbGluazogXCIvdGVzdGluZy93b3JrZmxvd3NcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiUmVhZGluZyBSZXN1bHRzXCIsIGxpbms6IFwiL3Rlc3RpbmcvcmVzdWx0c1wiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cblx0XHRcdFx0XCIvZGVwbG95bWVudHMvXCI6IFtcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHR0ZXh0OiBcIkRlcGxveW1lbnRzXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiU2VsZi1Ib3N0aW5nXCIsIGxpbms6IFwiL2RlcGxveW1lbnRzL1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJRdWljayBSdW4gKEtpdClcIiwgbGluazogXCIvZGVwbG95bWVudHMva2l0XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIlByb2R1Y3Rpb24gKEFkbWluICsgV29ya2VycylcIiwgbGluazogXCIvZGVwbG95bWVudHMvcHJvZHVjdGlvblwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJEZXBsb3kgd2l0aCBhIENvZGluZyBBZ2VudFwiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9jb2RpbmctYWdlbnRcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiRWRpdGlvbnNcIiwgbGluazogXCIvZGVwbG95bWVudHMvZWRpdGlvbnNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiTGljZW5zZXMgJiBDb250cmlidXRpb25zXCIsIGxpbms6IFwiL2RlcGxveW1lbnRzL2xpY2Vuc2luZ1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJTZWxmLVNpZ25lZCBMaWNlbnNlcyAocHJlLTEuMClcIiwgbGluazogXCIvZGVwbG95bWVudHMvc2VsZi1zaWduZWQtbGljZW5zZVwiIH0sXG5cdFx0XHRcdFx0XHRdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0dGV4dDogXCJLdWJlcm5ldGVzXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiSW5zdGFsbCBvbiBLdWJlcm5ldGVzXCIsIGxpbms6IFwiL2RlcGxveW1lbnRzL2t1YmVybmV0ZXMvaW5zdGFsbFwiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJDaGFydCBzZXR0aW5nc1wiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9rdWJlcm5ldGVzL2hlbG0tdmFsdWVzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkxvZ3MgYW5kIG1vbml0b3JpbmdcIiwgbGluazogXCIvZGVwbG95bWVudHMva3ViZXJuZXRlcy9vYnNlcnZhYmlsaXR5XCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkhvdyBpdCB3b3Jrc1wiLCBsaW5rOiBcIi9kZXBsb3ltZW50cy9rdWJlcm5ldGVzL1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJEZXZlbG9wIGFnYWluc3QgYSBsb2NhbCBjbHVzdGVyXCIsIGxpbms6IFwiL2RlcGxveW1lbnRzL2t1YmVybmV0ZXMvbG9jYWxcIiB9LFxuXHRcdFx0XHRcdFx0XSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRdLFxuXG5cdFx0XHRcdFwiL2ludGVncmF0aW9ucy9cIjogW1xuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdHRleHQ6IFwiSW50ZWdyYXRpb25zXCIsXG5cdFx0XHRcdFx0XHRpdGVtczogW1xuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiT3ZlcnZpZXdcIiwgbGluazogXCIvaW50ZWdyYXRpb25zL1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJJbnRlZ3JhdGlvbnMgZnJvbSBQbHVnaW5zXCIsIGxpbms6IFwiL2ludGVncmF0aW9ucy9wbHVnaW4taW50ZWdyYXRpb25zXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkRhdGFiYXNlc1wiLCBsaW5rOiBcIi9pbnRlZ3JhdGlvbnMvZGF0YWJhc2VzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIktWIFN0b3Jlc1wiLCBsaW5rOiBcIi9pbnRlZ3JhdGlvbnMva3Ytc3RvcmVzXCIgfSxcblx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIk9ic2VydmFiaWxpdHlcIiwgbGluazogXCIvaW50ZWdyYXRpb25zL29ic2VydmFiaWxpdHlcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiQUkgTW9kZWxzXCIsIGxpbms6IFwiL2ludGVncmF0aW9ucy9haS1tb2RlbHNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiVHJhY2UgdGhlIEFJIEFzc2lzdGFudFwiLCBsaW5rOiBcIi9pbnRlZ3JhdGlvbnMvYWdlbnQtdHJhY2luZ1wiIH0sXG5cdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJNZXNzYWdlIFF1ZXVlc1wiLCBsaW5rOiBcIi9pbnRlZ3JhdGlvbnMvbWVzc2FnZS1xdWV1ZXNcIiB9LFxuXHRcdFx0XHRcdFx0XHR7IHRleHQ6IFwiTUNQIFNlcnZlcnNcIiwgbGluazogXCIvaW50ZWdyYXRpb25zL21jcC1zZXJ2ZXJzXCIgfSxcblx0XHRcdFx0XHRcdF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XSxcblx0XHRcdH0sXG5cblx0XHRcdC8vIEVkaXQgbGluayBwb2ludGluZyB0byB0aGUgR2l0SHViIHNvdXJjZVxuXHRcdFx0ZWRpdExpbms6IHtcblx0XHRcdFx0cGF0dGVybjogXCJodHRwczovL2dpdGh1Yi5jb20vZmx1eGlmeS1yZXN0L0ZsdXhpZnkvZWRpdC9tYWluL2RvY3MvOnBhdGhcIixcblx0XHRcdFx0dGV4dDogXCJFZGl0IHRoaXMgcGFnZSBvbiBHaXRIdWJcIixcblx0XHRcdH0sXG5cblx0XHRcdC8vIFNvY2lhbCBsaW5rcyBpbiB0aGUgdG9wLXJpZ2h0IG5hdlxuXHRcdFx0c29jaWFsTGlua3M6IFt7IGljb246IFwiZ2l0aHViXCIsIGxpbms6IFwiaHR0cHM6Ly9naXRodWIuY29tL2ZsdXhpZnktcmVzdC9GbHV4aWZ5XCIgfV0sXG5cblx0XHRcdC8vIEZvb3RlclxuXHRcdFx0Zm9vdGVyOiB7XG5cdFx0XHRcdG1lc3NhZ2U6XG5cdFx0XHRcdFx0XCJSZWxlYXNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UgMi4wLiBFbnRlcnByaXNlIGZlYXR1cmVzIGFyZSB1bmRlciB0aGUgRmx1eGlmeSBFbnRlcnByaXNlIEVkaXRpb24gTGljZW5zZS5cIixcblx0XHRcdFx0Y29weXJpZ2h0OiBcIkNvcHlyaWdodCBcdTAwQTkgMjAyNiBGbHV4aWZ5XCIsXG5cdFx0XHR9LFxuXG5cdFx0XHQvLyBCdWlsdC1pbiBsb2NhbCBzZWFyY2ggKHJlcGxhY2VzIG1rZG9jcyBgc2VhcmNoYCBwbHVnaW4gXHUyMDE0IG5vIGV4dHJhIGNvbmZpZyBuZWVkZWQpXG5cdFx0XHRzZWFyY2g6IHtcblx0XHRcdFx0cHJvdmlkZXI6IFwibG9jYWxcIixcblx0XHRcdFx0b3B0aW9uczoge1xuXHRcdFx0XHRcdC8vIGFnZW50IHBhZ2VzIHN0YXkgb3V0IG9mIHRoZSBodW1hbiBzZWFyY2ggYm94IChzZWUgYWdlbnRQYWdlcylcblx0XHRcdFx0XHRfcmVuZGVyOiAoc3JjLCBlbnYsIG1kKSA9PlxuXHRcdFx0XHRcdFx0ZW52LnJlbGF0aXZlUGF0aC5zdGFydHNXaXRoKFwiYWdlbnRzL1wiKSA/IFwiXCIgOiBtZC5yZW5kZXIoc3JjLCBlbnYpLFxuXHRcdFx0XHR9LFxuXHRcdFx0fSxcblxuXHRcdFx0Ly8gT3V0bGluZSAodGFibGUgb2YgY29udGVudHMpIFx1MjAxNCBtaXJyb3JzIG1rZG9jcyB0b2NfZGVwdGg6IDNcblx0XHRcdG91dGxpbmU6IHtcblx0XHRcdFx0bGV2ZWw6IFsyLCAzXSxcblx0XHRcdFx0bGFiZWw6IFwiT24gVGhpcyBQYWdlXCIsXG5cdFx0XHR9LFxuXG5cdFx0XHQvLyBQcmV2aW91cyAvIG5leHQgcGFnZSBsaW5rcyBhdCB0aGUgYm90dG9tXG5cdFx0XHRkb2NGb290ZXI6IHtcblx0XHRcdFx0cHJldjogXCJQcmV2aW91c1wiLFxuXHRcdFx0XHRuZXh0OiBcIk5leHRcIixcblx0XHRcdH0sXG5cblx0XHRcdGxhc3RVcGRhdGVkOiB7XG5cdFx0XHRcdHRleHQ6IFwiTGFzdCB1cGRhdGVkXCIsXG5cdFx0XHR9LFxuXHRcdH0sXG5cblx0XHRtYXJrZG93bjoge1xuXHRcdFx0Ly8gTGluZSBudW1iZXJzIGluIGNvZGUgYmxvY2tzXG5cdFx0XHRsaW5lTnVtYmVyczogZmFsc2UsXG5cdFx0XHQvLyBDb250YWluZXIgYWxpYXNlcyB0aGF0IG1hcCBta2RvY3MgYWRtb25pdGlvbi1zdHlsZSBibG9ja3M6XG5cdFx0XHQvLyBVc2UgOjo6IHRpcCAvIDo6OiB3YXJuaW5nIC8gOjo6IGRhbmdlciAvIDo6OiBpbmZvIGluIG1hcmtkb3duIGZpbGVzLlxuXHRcdH0sXG5cblx0XHR2aXRlOiB7XG5cdFx0XHRwbHVnaW5zOiBbXG5cdFx0XHRcdC8vIG9yZGVyIG1hdHRlcnM6IGJvdGggcnVuIGJlZm9yZSBsbG1zdHh0IHJlYWRzIHRoZSBwYWdlXG5cdFx0XHRcdGZyb250bWF0dGVyRGVmYXVsdHMoRE9DU19ESVIpLFxuXHRcdFx0XHQvLyAlJVJFTEVBU0VfVEFHJSUgKHYwLjEuMCkgYW5kICUlQ0hBUlRfVkVSU0lPTiUlICgwLjEuMCkgaW4gYW55IHBhZ2UsIGNvZGVcblx0XHRcdFx0Ly8gYmxvY2tzIGluY2x1ZGVkLCBiZWNvbWUgdGhlIG5ld2VzdCByZWxlYXNlLCBpbiB0aGUgSFRNTCBhbmQgdGhlIGxsbXMgY29waWVzXG5cdFx0XHRcdHtcblx0XHRcdFx0XHRuYW1lOiBcImZsdXhpZnk6cmVsZWFzZS12ZXJzaW9uXCIsXG5cdFx0XHRcdFx0ZW5mb3JjZTogXCJwcmVcIixcblx0XHRcdFx0XHR0cmFuc2Zvcm0oY29kZSwgaWQpIHtcblx0XHRcdFx0XHRcdGlmICghaWQuZW5kc1dpdGgoXCIubWRcIikgfHwgIWNvZGUuaW5jbHVkZXMoXCIlJVwiKSkgcmV0dXJuIG51bGw7XG5cdFx0XHRcdFx0XHRyZXR1cm4gY29kZVxuXHRcdFx0XHRcdFx0XHQucmVwbGFjZUFsbChcIiUlUkVMRUFTRV9UQUclJVwiLCByZWxlYXNlVGFnKVxuXHRcdFx0XHRcdFx0XHQucmVwbGFjZUFsbChcIiUlQ0hBUlRfVkVSU0lPTiUlXCIsIHJlbGVhc2VUYWcucmVwbGFjZSgvXnYvLCBcIlwiKSk7XG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0fSxcblx0XHRcdFx0Ly8gbGxtcy50eHQgaW5kZXgsIGxsbXMtZnVsbC50eHQgYW5kIGEgLm1kIGNvcHkgb2YgZXZlcnkgcGFnZSwgZm9yIEFJIGFnZW50c1xuXHRcdFx0XHRsbG1zdHh0KHtcblx0XHRcdFx0XHRkb21haW46IFNJVEVfVVJMLFxuXHRcdFx0XHRcdC8vIGVtcHR5IHBsYWNlaG9sZGVyIHBhZ2VzICh0aGUgcmVhbCBjb250ZW50IGlzIGludGVncmF0aW9ucy9kYXRhYmFzZXMubWQpLCBhbmRcblx0XHRcdFx0XHQvLyBibG9nIHBvc3RzLCB3aGljaCB0aGUgcGx1Z2luJ3Mgb3duIGJsb2cgcHJlc2V0IG1pc3NlcyB1bmRlciBibG9nL3Bvc3RzL1xuXHRcdFx0XHRcdGlnbm9yZUZpbGVzOiBbXCJpbnRlZ3JhdGlvbnMvZGF0YWJhc2VzLypcIiwgXCJibG9nLyoqXCJdLFxuXHRcdFx0XHRcdHNpZGViYXI6IGxsbXNTaWRlYmFyLFxuXHRcdFx0XHR9KSxcblx0XHRcdF0sXG5cdFx0XHRvcHRpbWl6ZURlcHM6IHtcblx0XHRcdFx0Ly8gdml0ZXByZXNzLXBsdWdpbi1tZXJtYWlkIGluamVjdHMgdGhlIE1lcm1haWQgY29tcG9uZW50IGludG8gZXZlcnlcblx0XHRcdFx0Ly8gcGFnZSdzIGNsaWVudCBlbnRyeSB2aWEgYSBwb3N0LXRyYW5zZm9ybSwgd2hpY2ggVml0ZSdzIGNvbGQtc3RhcnRcblx0XHRcdFx0Ly8gZGVwZW5kZW5jeSBzY2FubmVyIGRvZXNuJ3Qgc2VlLiBXaXRob3V0IHRoaXMsIG1lcm1haWQgKGFuZCBpdHNcblx0XHRcdFx0Ly8gQ0pTIGBkYXlqc2AgZGVwZW5kZW5jeSkgZ2V0cyBzZXJ2ZWQgdW5idW5kbGVkIG9uIGEgZnJlc2ggY2FjaGUsXG5cdFx0XHRcdC8vIHRocm93aW5nIFwiZG9lcyBub3QgcHJvdmlkZSBhbiBleHBvcnQgbmFtZWQgJ2RlZmF1bHQnXCIuXG5cdFx0XHRcdGluY2x1ZGU6IFtcIm1lcm1haWRcIl0sXG5cdFx0XHR9LFxuXHRcdH0sXG5cdH0pLFxuKTtcbiIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL1VzZXJzL3lhc2hhc2hfa3VtYXIvZmx1eGlmeS9GbHV4aWZ5L2RvY3MvLnZpdGVwcmVzc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL3lhc2hhc2hfa3VtYXIvZmx1eGlmeS9GbHV4aWZ5L2RvY3MvLnZpdGVwcmVzcy9mcm9udG1hdHRlckRlZmF1bHRzLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy95YXNoYXNoX2t1bWFyL2ZsdXhpZnkvRmx1eGlmeS9kb2NzLy52aXRlcHJlc3MvZnJvbnRtYXR0ZXJEZWZhdWx0cy50c1wiO2ltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCB0eXBlIHsgUGx1Z2luIH0gZnJvbSBcInZpdGVcIjtcblxuLyoqIFBhZ2VzIHRoYXQgYXJlIG5vdCBsaXN0ZWQgaW4gbGxtcy50eHQsIHNvIHRoZXkgbmVlZCBubyB0aXRsZSBvciBkZXNjcmlwdGlvbi4gKi9cbmNvbnN0IFNLSVAgPSBbL15pbmRleFxcLm1kJC8sIC9eYmxvZ1xcLy9dO1xuXG4vKiogVml0ZVByZXNzIGJ1aWxkcyBjbGllbnQgYW5kIHNlcnZlciBidW5kbGVzLCBzbyBlYWNoIHBhZ2UgcGFzc2VzIHRocm91Z2ggdHdpY2UuICovXG5jb25zdCB3YXJuZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuLyoqIFBsYWluIHRleHQgb2YgYSBwYWdlIGJvZHk6IG5vIGNvZGUsIGhlYWRpbmdzIG1hcmtlcnMsIGxpbmtzLCB0YWdzIG9yIG1hcmt1cC4gKi9cbmZ1bmN0aW9uIHBsYWluVGV4dChib2R5OiBzdHJpbmcpIHtcblx0cmV0dXJuIGJvZHlcblx0XHQucmVwbGFjZSgvYGBgW1xcc1xcU10qP2BgYC9nLCBcIiBcIilcblx0XHQucmVwbGFjZSgvPFtePl0rPi9nLCBcIiBcIilcblx0XHQucmVwbGFjZSgvXjo6Oi4qJC9nbSwgXCIgXCIpXG5cdFx0LnJlcGxhY2UoLyE/XFxbKFteXFxdXSopXFxdXFwoW14pXSpcXCkvZywgXCIkMVwiKVxuXHRcdC5yZXBsYWNlKC9eIytcXHMuKiQvZ20sIFwiIFwiKVxuXHRcdC5yZXBsYWNlKC9bKl9gPnxdL2csIFwiXCIpXG5cdFx0LnJlcGxhY2UoL1xccysvZywgXCIgXCIpXG5cdFx0LnRyaW0oKTtcbn1cblxuLyoqXG4gKiBFdmVyeSBwYWdlIG5lZWRzIGEgYHRpdGxlYCBhbmQgYGRlc2NyaXB0aW9uYCBmb3IgbGxtcy50eHQuIEEgbWlzc2luZyBvbmUgaXNcbiAqIHdhcm5lZCBhYm91dCBhbmQgZmlsbGVkIGluIFx1MjAxNCB0aXRsZSBmcm9tIHRoZSBmaXJzdCBgIyBgIGhlYWRpbmcgKGVsc2VcbiAqIFwiVW50aXRsZWRcIiksIGRlc2NyaXB0aW9uIHRoZSBmaXJzdCAxMDAgY2hhcmFjdGVycyBvZiB0aGUgcGFnZSB0ZXh0IFx1MjAxNCBzbyB0aGVcbiAqIGJ1aWxkIHN0aWxsIGZpbmlzaGVzLlxuICpcbiAqIFJ1bnMgYmVmb3JlIHZpdGVwcmVzcy1wbHVnaW4tbGxtcywgd2hpY2ggcmVhZHMgdGhlIGZyb250bWF0dGVyIGl0IGxlYXZlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250bWF0dGVyRGVmYXVsdHMoc3JjRGlyOiBzdHJpbmcpOiBQbHVnaW4ge1xuXHRyZXR1cm4ge1xuXHRcdG5hbWU6IFwiZmx1eGlmeTpmcm9udG1hdHRlci1kZWZhdWx0c1wiLFxuXHRcdGVuZm9yY2U6IFwicHJlXCIsXG5cdFx0dHJhbnNmb3JtKGNvZGUsIGlkKSB7XG5cdFx0XHRpZiAoIWlkLmVuZHNXaXRoKFwiLm1kXCIpKSByZXR1cm4gbnVsbDtcblx0XHRcdGNvbnN0IHBhZ2UgPSBwYXRoLnJlbGF0aXZlKHNyY0RpciwgaWQpLnJlcGxhY2VBbGwoXCJcXFxcXCIsIFwiL1wiKTtcblx0XHRcdGlmIChwYWdlLnN0YXJ0c1dpdGgoXCIuLlwiKSB8fCBTS0lQLnNvbWUoKHJlKSA9PiByZS50ZXN0KHBhZ2UpKSkgcmV0dXJuIG51bGw7XG5cblx0XHRcdGNvbnN0IHRleHQgPSBjb2RlLnJlcGxhY2UoL1xcclxcbi9nLCBcIlxcblwiKTtcblx0XHRcdGNvbnN0IG1hdGNoID0gdGV4dC5tYXRjaCgvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLVxcbj8vKTtcblx0XHRcdGNvbnN0IHlhbWwgPSBtYXRjaD8uWzFdID8/IFwiXCI7XG5cdFx0XHRjb25zdCBib2R5ID0gbWF0Y2ggPyB0ZXh0LnNsaWNlKG1hdGNoWzBdLmxlbmd0aCkgOiB0ZXh0O1xuXHRcdFx0aWYgKCFib2R5LnRyaW0oKSkgcmV0dXJuIG51bGw7XG5cblx0XHRcdGNvbnN0IGFkZGVkOiBzdHJpbmdbXSA9IFtdO1xuXHRcdFx0aWYgKCEvXnRpdGxlOi9tLnRlc3QoeWFtbCkpIHtcblx0XHRcdFx0Y29uc3QgaGVhZGluZyA9IGJvZHkubWF0Y2goL14jXFxzKyguKykkL20pPy5bMV0/LnRyaW0oKTtcblx0XHRcdFx0YWRkZWQucHVzaChgdGl0bGU6ICR7SlNPTi5zdHJpbmdpZnkoaGVhZGluZyB8fCBcIlVudGl0bGVkXCIpfWApO1xuXHRcdFx0fVxuXHRcdFx0aWYgKCEvXmRlc2NyaXB0aW9uOi9tLnRlc3QoeWFtbCkpIHtcblx0XHRcdFx0YWRkZWQucHVzaChgZGVzY3JpcHRpb246ICR7SlNPTi5zdHJpbmdpZnkocGxhaW5UZXh0KGJvZHkpLnNsaWNlKDAsIDEwMCkpfWApO1xuXHRcdFx0fVxuXHRcdFx0aWYgKCFhZGRlZC5sZW5ndGgpIHJldHVybiBudWxsO1xuXG5cdFx0XHRjb25zdCBmaWVsZHMgPSBhZGRlZC5tYXAoKGxpbmUpID0+IGxpbmUuc3BsaXQoXCI6XCIpWzBdKS5qb2luKFwiIGFuZCBcIik7XG5cdFx0XHRpZiAoIXdhcm5lZC5oYXMocGFnZSkpXG5cdFx0XHRcdGNvbnNvbGUud2FybihgW2RvY3NdICR7cGFnZX0gaGFzIG5vICR7ZmllbGRzfSBpbiBpdHMgZnJvbnRtYXR0ZXI7IHVzaW5nIGEgZGVmYXVsdGApO1xuXHRcdFx0d2FybmVkLmFkZChwYWdlKTtcblx0XHRcdGNvbnN0IGZyb250bWF0dGVyID0gW3lhbWwsIC4uLmFkZGVkXS5maWx0ZXIoQm9vbGVhbikuam9pbihcIlxcblwiKTtcblx0XHRcdHJldHVybiB7IGNvZGU6IGAtLS1cXG4ke2Zyb250bWF0dGVyfVxcbi0tLVxcbiR7Ym9keX1gLCBtYXA6IG51bGwgfTtcblx0XHR9LFxuXHR9O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFvVSxTQUFTLGdCQUFnQjtBQUM3VixTQUFTLGFBQWEsb0JBQW9CO0FBQzFDLFNBQVMscUJBQXFCO0FBQzlCLFNBQTRCLG9CQUFvQjtBQUNo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QUFBQSxRQUNULFNBQVM7QUFBQSxRQUNULE1BQU07QUFBQSxNQUNQO0FBQUE7QUFBQSxNQUdBLGFBQWEsQ0FBQyxFQUFFLE1BQU0sVUFBVSxNQUFNLDBDQUEwQyxDQUFDO0FBQUE7QUFBQSxNQUdqRixRQUFRO0FBQUEsUUFDUCxTQUNDO0FBQUEsUUFDRCxXQUFXO0FBQUEsTUFDWjtBQUFBO0FBQUEsTUFHQSxRQUFRO0FBQUEsUUFDUCxVQUFVO0FBQUEsUUFDVixTQUFTO0FBQUE7QUFBQSxVQUVSLFNBQVMsQ0FBQyxLQUFLLEtBQUssT0FDbkIsSUFBSSxhQUFhLFdBQVcsU0FBUyxJQUFJLEtBQUssR0FBRyxPQUFPLEtBQUssR0FBRztBQUFBLFFBQ2xFO0FBQUEsTUFDRDtBQUFBO0FBQUEsTUFHQSxTQUFTO0FBQUEsUUFDUixPQUFPLENBQUMsR0FBRyxDQUFDO0FBQUEsUUFDWixPQUFPO0FBQUEsTUFDUjtBQUFBO0FBQUEsTUFHQSxXQUFXO0FBQUEsUUFDVixNQUFNO0FBQUEsUUFDTixNQUFNO0FBQUEsTUFDUDtBQUFBLE1BRUEsYUFBYTtBQUFBLFFBQ1osTUFBTTtBQUFBLE1BQ1A7QUFBQSxJQUNEO0FBQUEsSUFFQSxVQUFVO0FBQUE7QUFBQSxNQUVULGFBQWE7QUFBQTtBQUFBO0FBQUEsSUFHZDtBQUFBLElBRUEsTUFBTTtBQUFBLE1BQ0wsU0FBUztBQUFBO0FBQUEsUUFFUixvQkFBb0IsUUFBUTtBQUFBO0FBQUE7QUFBQSxRQUc1QjtBQUFBLFVBQ0MsTUFBTTtBQUFBLFVBQ04sU0FBUztBQUFBLFVBQ1QsVUFBVSxNQUFNLElBQUk7QUFDbkIsZ0JBQUksQ0FBQyxHQUFHLFNBQVMsS0FBSyxLQUFLLENBQUMsS0FBSyxTQUFTLElBQUksRUFBRyxRQUFPO0FBQ3hELG1CQUFPLEtBQ0wsV0FBVyxtQkFBbUIsVUFBVSxFQUN4QyxXQUFXLHFCQUFxQixXQUFXLFFBQVEsTUFBTSxFQUFFLENBQUM7QUFBQSxVQUMvRDtBQUFBLFFBQ0Q7QUFBQTtBQUFBLFFBRUEsUUFBUTtBQUFBLFVBQ1AsUUFBUTtBQUFBO0FBQUE7QUFBQSxVQUdSLGFBQWEsQ0FBQyw0QkFBNEIsU0FBUztBQUFBLFVBQ25ELFNBQVM7QUFBQSxRQUNWLENBQUM7QUFBQSxNQUNGO0FBQUEsTUFDQSxjQUFjO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFFBTWIsU0FBUyxDQUFDLFNBQVM7QUFBQSxNQUNwQjtBQUFBLElBQ0Q7QUFBQSxFQUNELENBQUM7QUFDRjsiLAogICJuYW1lcyI6IFtdCn0K
