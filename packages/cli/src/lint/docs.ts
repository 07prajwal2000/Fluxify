// The portal's Docs panel renders a small markdown subset (see AGENT.md,
// "Block Pages Are Also Rendered in the Portal Docs Panel"). Anything else
// shows as literal text, so the build warns.

const CONTAINERS = ["info", "tip", "warning", "danger"];

const RULES: { test: RegExp; message: string }[] = [
	{ test: /<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i, message: "raw HTML is not rendered" },
	{ test: /!\[[^\]]*\]\(/, message: "images are not rendered" },
	{
		test: /\[[^\]]*\]\(#/,
		message: "in-page links go nowhere: the panel opens links in a new tab",
	},
	{ test: /^#{1,6}\s.*\{#[^}]+\}\s*$/, message: "heading ids ({#id}) print as text" },
];

/** What the panel cannot render in a block's `docs`, as "line N: message". Code is skipped. */
export function lintDocs(docs: string): string[] {
	const found: string[] = [];
	let fence: string | undefined;
	for (const [i, line] of docs.split("\n").entries()) {
		const marker = line.match(/^\s*(```+|~~~+)/)?.[1];
		if (marker) {
			if (!fence) fence = marker[0];
			else if (marker[0] === fence) fence = undefined;
			continue;
		}
		if (fence) continue;
		const container = line.match(/^\s*:::\s*(\S*)/);
		if (container?.[1] && !CONTAINERS.includes(container[1]))
			found.push(
				`line ${i + 1}: ::: ${container[1]} is not rendered; use ${CONTAINERS.join(", ")}`,
			);
		const text = line.replace(/`[^`]*`/g, "");
		for (const { test, message } of RULES)
			if (test.test(text)) found.push(`line ${i + 1}: ${message}`);
	}
	return found;
}
