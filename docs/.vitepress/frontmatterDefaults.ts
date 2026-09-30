import path from "node:path";
import type { Plugin } from "vite";

/** Pages that are not listed in llms.txt, so they need no title or description. */
const SKIP = [/^index\.md$/, /^blog\//];

/** VitePress builds client and server bundles, so each page passes through twice. */
const warned = new Set<string>();

/** Plain text of a page body: no code, headings markers, links, tags or markup. */
function plainText(body: string) {
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

/**
 * Every page needs a `title` and `description` for llms.txt. A missing one is
 * warned about and filled in — title from the first `# ` heading (else
 * "Untitled"), description the first 100 characters of the page text — so the
 * build still finishes.
 *
 * Runs before vitepress-plugin-llms, which reads the frontmatter it leaves.
 */
export function frontmatterDefaults(srcDir: string): Plugin {
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

			const added: string[] = [];
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
			return { code: `---\n${frontmatter}\n---\n${body}`, map: null };
		},
	};
}
