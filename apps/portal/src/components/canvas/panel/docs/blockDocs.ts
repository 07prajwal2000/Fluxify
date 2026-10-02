import { BLOCK_TYPES, type BlockType } from "../../blocks/blockTypes";

export const DOCS_SITE = "https://docs.fluxify.rest";

/**
 * Block type → page in `docs/blocks/`. Page names are public URLs, so they stay
 * as they are; typed on `BlockType` so a new block fails the typecheck until it
 * has a page.
 */
export const BLOCK_DOC_PAGES: Record<BlockType, string> = {
	[BLOCK_TYPES.entrypoint]: "entrypoint",
	[BLOCK_TYPES.response]: "response",
	[BLOCK_TYPES.errorHandler]: "error-handler",
	[BLOCK_TYPES.stickynote]: "sticky-note",
	[BLOCK_TYPES.if]: "if-condition",
	[BLOCK_TYPES.forloop]: "for-loop",
	[BLOCK_TYPES.foreachloop]: "foreach-loop",
	[BLOCK_TYPES.orchestrator]: "orchestrator",
	[BLOCK_TYPES.switch]: "switch",
	[BLOCK_TYPES.transformer]: "transformer",
	[BLOCK_TYPES.jsrunner]: "js-runner",
	[BLOCK_TYPES.setvar]: "set-var",
	[BLOCK_TYPES.getvar]: "get-var",
	[BLOCK_TYPES.arrayops]: "array-operations",
	[BLOCK_TYPES.httprequest]: "http-request",
	[BLOCK_TYPES.httpgetheader]: "get-http-header",
	[BLOCK_TYPES.httpsetheader]: "set-http-header",
	[BLOCK_TYPES.httpgetparam]: "get-http-param",
	[BLOCK_TYPES.httpgetcookie]: "get-request-cookie",
	[BLOCK_TYPES.httpsetcookie]: "set-http-cookie",
	[BLOCK_TYPES.httpgetrequestbody]: "get-http-request-body",
	[BLOCK_TYPES.db_getsingle]: "db-get-single",
	[BLOCK_TYPES.db_exists]: "db-row-exists",
	[BLOCK_TYPES.db_count]: "db-count",
	[BLOCK_TYPES.db_getall]: "db-get-all",
	[BLOCK_TYPES.db_insert]: "db-insert",
	[BLOCK_TYPES.db_insertbulk]: "db-insert-bulk",
	[BLOCK_TYPES.db_update]: "db-update",
	[BLOCK_TYPES.db_delete]: "db-delete",
	[BLOCK_TYPES.db_native]: "db-native",
	[BLOCK_TYPES.db_transaction]: "db-transaction",
	[BLOCK_TYPES.db_rollback]: "db-rollback",
	[BLOCK_TYPES.kv_raw]: "kv-raw",
	[BLOCK_TYPES.kv_operations]: "kv-operations",
	[BLOCK_TYPES.queue_send]: "send-message",
	[BLOCK_TYPES.consolelog]: "console-log",
	[BLOCK_TYPES.cloudLogs]: "cloud-logs",
	[BLOCK_TYPES.triggerWorkflow]: "trigger-workflow",
};

export function blockDocPage(type: string): string | undefined {
	return BLOCK_DOC_PAGES[type as BlockType];
}

export function docsPageUrl(page: string) {
	return `${DOCS_SITE}/blocks/${page}.html`;
}

/**
 * VitePress markdown → what `MarkdownViewer` renders: drops the frontmatter,
 * turns `::: tip Title` into a `:::tip[Title]` directive, and points relative
 * links (`./x.md`, `/blocks/x#y`) at the docs site so they work from the panel.
 */
export function toPanelMarkdown(source: string, page: string): string {
	const base = docsPageUrl(page);
	return source
		.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
		.replace(/^:::[ \t]*(\w+)[ \t]*(.*)$/gm, (_, kind: string, title: string) =>
			title.trim() ? `:::${kind}[${title.trim()}]` : `:::${kind}`,
		)
		.replace(/\]\(((?!https?:|mailto:|#)[^)\s]+)\)/g, (_, href: string) => {
			const url = new URL(href, base);
			url.pathname = url.pathname.replace(/\.md$/, ".html");
			return `](${url.href})`;
		})
		.trim();
}
