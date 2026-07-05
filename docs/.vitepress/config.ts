import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
	title: "Fluxify",
	description: "No/Low Code Backend Engine to Build APIs with ease",
	lang: "en-US",

	// The docs live in the repo root /docs directory, so no srcDir needed.
	// Site is deployed at https://docs.fluxify.rest
	base: "/",

	// Warn on dead links but don't fail the build for pre-existing issues
	ignoreDeadLinks: true,

	head: [
		[
			"link",
			{ rel: "icon", type: "image/x-icon", href: "/assets/favicon.ico" },
		],
		["link", { rel: "icon", type: "image/png", href: "/assets/logo.png" }],
		["meta", { name: "theme-color", content: "#5f67ee" }],
	],

	// Source markdown lives in docs/, config is in docs/.vitepress/
	// VitePress picks this up automatically when run as `vitepress dev docs`

	themeConfig: {
		// https://vitepress.dev/reference/default-theme-config
		logo: "/assets/logo.png",
		siteTitle: "Fluxify",

		nav: [
			{ text: "Home", link: "/" },
			{ text: "Getting Started", link: "/getting-started/" },
			{
				text: "Concepts",
				items: [
					{ text: "Overview", link: "/concepts/" },
					{ text: "App Config", link: "/concepts/app-config" },
					{ text: "Blocks", link: "/concepts/blocks" },
					{ text: "Edges", link: "/concepts/edges" },
					{ text: "Execution Context", link: "/concepts/context" },
					{ text: "Execution Engine", link: "/concepts/execution-engine" },
					{ text: "Globals", link: "/concepts/globals" },
					{ text: "Integrations", link: "/concepts/integrations" },
					{ text: "Virtual Machine", link: "/concepts/vm" },
					{ text: "HTTP Client", link: "/concepts/http-client" },
					{ text: "Evaluators", link: "/concepts/evaluators" },
					{ text: "Logging", link: "/concepts/logging" },
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
				text: "Scripting",
				items: [
					{ text: "Overview", link: "/scripting/" },
					{ text: "Context", link: "/scripting/context" },
					{ text: "How It Works", link: "/scripting/how-it-works" },
					{ text: "Key Considerations", link: "/scripting/key-considerations" },
					{ text: "NPM Packages", link: "/scripting/npm-packages" },
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
						{ text: "Contributing", link: "/getting-started/contributing" },
						{ text: "Local Testing", link: "/getting-started/local-testing" },
					],
				},
			],

			"/concepts/": [
				{
					text: "Concepts",
					items: [
						{ text: "Overview", link: "/concepts/" },
						{ text: "App Config", link: "/concepts/app-config" },
						{ text: "Blocks", link: "/concepts/blocks" },
						{ text: "Edges", link: "/concepts/edges" },
						{ text: "Execution Context", link: "/concepts/context" },
						{ text: "Execution Engine", link: "/concepts/execution-engine" },
						{ text: "Globals", link: "/concepts/globals" },
						{ text: "Integrations", link: "/concepts/integrations" },
						{ text: "Virtual Machine", link: "/concepts/vm" },
						{ text: "HTTP Client", link: "/concepts/http-client" },
						{ text: "Evaluators", link: "/concepts/evaluators" },
						{ text: "Logging", link: "/concepts/logging" },
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
					text: "Logic",
					items: [
						{ text: "Entrypoint", link: "/blocks/entrypoint" },
						{ text: "If Condition", link: "/blocks/if-condition" },
						{ text: "For Loop", link: "/blocks/for-loop" },
						{ text: "Error Handler", link: "/blocks/error-handler" },
						{ text: "JS Runner", link: "/blocks/js-runner" },
						{ text: "Transformer", link: "/blocks/transformer" },
						{ text: "Array Operations", link: "/blocks/array-operations" },
					],
				},
				{
					text: "HTTP",
					items: [
						{ text: "Response", link: "/blocks/response" },
						{ text: "HTTP Request", link: "/blocks/http-request" },
						{ text: "Get Header", link: "/blocks/get-http-header" },
						{ text: "Get Query Param", link: "/blocks/get-http-param" },
						{ text: "Get Request Body", link: "/blocks/get-http-request-body" },
						{ text: "Set HTTP Header", link: "/blocks/set-http-header" },
						{ text: "Get Cookie", link: "/blocks/get-request-cookie" },
						{ text: "Set Cookie", link: "/blocks/set-http-cookie" },
					],
				},
				{
					text: "Variables",
					items: [
						{ text: "Get Variable", link: "/blocks/get-var" },
						{ text: "Set Variable", link: "/blocks/set-var" },
					],
				},
				{
					text: "Database",
					items: [
						{ text: "DB Get All", link: "/blocks/db-get-all" },
						{ text: "DB Get Single", link: "/blocks/db-get-single" },
						{ text: "DB Insert", link: "/blocks/db-insert" },
						{ text: "DB Insert Bulk", link: "/blocks/db-insert-bulk" },
						{ text: "DB Update", link: "/blocks/db-update" },
						{ text: "DB Delete", link: "/blocks/db-delete" },
						{ text: "DB Native", link: "/blocks/db-native" },
						{ text: "DB Transaction", link: "/blocks/db-transaction" },
					],
				},
				{
					text: "Logging",
					items: [
						{ text: "Console Log", link: "/blocks/console-log" },
						{ text: "Cloud Logs", link: "/blocks/cloud-logs" },
					],
				},
				{
					text: "Misc",
					items: [{ text: "Sticky Note", link: "/blocks/sticky-note" }],
				},
			],

			"/scripting/": [
				{
					text: "Scripting",
					items: [
						{ text: "Overview", link: "/scripting/" },
						{ text: "Context", link: "/scripting/context" },
						{ text: "How It Works", link: "/scripting/how-it-works" },
						{
							text: "Key Considerations",
							link: "/scripting/key-considerations",
						},
						{ text: "NPM Packages", link: "/scripting/npm-packages" },
					],
				},
			],

			"/deployments/": [
				{
					text: "Deployments",
					items: [
						{ text: "Self-Hosting", link: "/deployments/" },
					],
				},
			],

			"/integrations/": [
				{
					text: "Integrations",
					items: [
						{ text: "Overview", link: "/integrations/" },
						{ text: "Databases", link: "/integrations/databases" },
						{ text: "Observability", link: "/integrations/observability" },
						{ text: "AI Models", link: "/integrations/ai-models" },
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
		socialLinks: [
			{ icon: "github", link: "https://github.com/fluxify-rest/Fluxify" },
		],

		// Footer
		footer: {
			message: "Released under the MIT License.",
			copyright: "Copyright © 2026 Fluxify",
		},

		// Built-in local search (replaces mkdocs `search` plugin — no extra config needed)
		search: {
			provider: "local",
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
});
