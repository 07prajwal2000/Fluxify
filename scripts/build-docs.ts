// Builds the versioned docs site (#1156) into docs/.vitepress/dist:
//   /          the newest release
//   /nightly/  main (this checkout)
//   /<tag>/    older releases
// VitePress has no versioning, so each version is its own build with its own
// base. The docs config reads DOCS_BASE, DOCS_VERSION and DOCS_VERSIONS. A
// release's build uses that release's own config, so never rename them.
//
// Releases come from DOCS_RELEASES (newest first, space-separated; CI passes
// GitHub's list) or the local v* tags. Tags made before #1156 can't take a base,
// so they're skipped, and until a release supports it the site is main at /.
//
// A release build never changes, so builds are kept in .docs-versions/releases
// (CI caches it) and reused while the version list stays the same.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { $ } from "bun";

const SITE_URL = "https://docs.fluxify.rest";
// ponytail: fixed cap so deploy time stays bounded; raise it if users need older docs
const MAX_RELEASES = 10;
const WORK = ".docs-versions";
const RELEASES = `${WORK}/releases`;
const OUT = "docs/.vitepress/dist";

type Build = { tag?: string; label: string; base: string };
type Link = { text: string; link: string; target: "_self"; noIcon: true };

/** What to build, from the releases (newest first) whose docs support a base. */
export function plan(supported: string[]): { builds: Build[]; versions: Link[] } {
	const tags = supported.slice(0, MAX_RELEASES);
	if (!tags.length) return { builds: [{ label: "Nightly", base: "/" }], versions: [] };
	// Full URLs: VitePress prefixes a path link with the current build's base.
	const link = (text: string, base: string): Link => ({
		text,
		link: `${SITE_URL}${base}`,
		target: "_self",
		noIcon: true,
	});
	const builds: Build[] = [
		{ tag: tags[0], label: tags[0], base: "/" },
		{ label: "Nightly", base: "/nightly/" },
		...tags.slice(1).map((tag) => ({ tag, label: tag, base: `/${tag}/` })),
	];
	return {
		builds,
		versions: builds.map((b) => link(b.base === "/" ? `${b.label} (latest)` : b.label, b.base)),
	};
}

async function releaseTags(): Promise<string[]> {
	const list = process.env.DOCS_RELEASES ?? (await $`git tag --list v* --sort=-creatordate`.text());
	return list.split(/\s+/).filter(Boolean);
}

async function supportsBase(tag: string): Promise<boolean> {
	const config = await $`git show ${tag}:docs/.vitepress/config.ts`.nothrow().quiet();
	return config.exitCode === 0 && config.text().includes("DOCS_BASE");
}

async function build(srcDir: string, outDir: string, b: Build, versions: Link[]) {
	console.log(`\n▶ ${b.label} → ${b.base}`);
	await $`bun x vitepress build ${srcDir} --outDir ${outDir}`.env({
		...process.env,
		DOCS_BASE: b.base,
		DOCS_VERSION: b.label,
		DOCS_VERSIONS: JSON.stringify(versions),
		// install commands in a release's docs name that release
		...(b.tag ? { FLUXIFY_RELEASE_TAG: b.tag } : {}),
	});
}

async function main() {
	const supported: string[] = [];
	for (const tag of await releaseTags()) if (await supportsBase(tag)) supported.push(tag);
	const { builds, versions } = plan(supported);

	// cached release builds embed the version list, so a new list rebuilds them
	const stamp = `${RELEASES}/versions.json`;
	const list = JSON.stringify(versions);
	if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== list)
		rmSync(RELEASES, { recursive: true, force: true });
	mkdirSync(RELEASES, { recursive: true });

	for (const b of builds.filter((b) => b.tag)) {
		const tag = b.tag as string;
		const dir = `${RELEASES}/${tag}`;
		if (existsSync(`${dir}/index.html`)) {
			console.log(`✓ ${tag} (cached)`);
			continue;
		}
		const src = `${WORK}/src/${tag}`;
		rmSync(src, { recursive: true, force: true });
		mkdirSync(src, { recursive: true });
		await $`git archive ${tag} docs | tar -x -C ${src}`;
		await build(`${src}/docs`, dir, b, versions);
	}
	writeFileSync(stamp, list);

	rmSync(OUT, { recursive: true, force: true });
	for (const b of builds) {
		const out = `${OUT}${b.base}`;
		if (b.tag) cpSync(`${RELEASES}/${b.tag}`, out, { recursive: true });
		else await build("docs", out, b, versions);
	}
}

if (import.meta.main) await main();
