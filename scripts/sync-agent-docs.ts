import { readdir, readFile, rm, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type AgentDocEntry = {
	source: string;
	url: string;
};

type AgentDocManifest = {
	schemaVersion: 1;
	docs: AgentDocEntry[];
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const docsRoot = path.join(repositoryRoot, "docs");
const publicAgentDocsRoot = path.join(docsRoot, "public", "agent-docs");
const manifestPath = path.join(publicAgentDocsRoot, "index.json");

async function findAgentDocs(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		if (entry.name === ".vitepress" || entry.name === "public") continue;

		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await findAgentDocs(absolutePath)));
		} else if (entry.isFile() && entry.name.endsWith(".agent.md")) {
			files.push(absolutePath);
		}
	}

	return files;
}

async function removePreviouslyPublishedDocs(): Promise<void> {
	try {
		const previous = JSON.parse(await readFile(manifestPath, "utf8")) as AgentDocManifest;
		for (const entry of previous.docs) {
			const relativePath = entry.url.replace(/^\/agent-docs\//, "");
			const publishedPath = path.resolve(publicAgentDocsRoot, relativePath);
			if (publishedPath.startsWith(`${publicAgentDocsRoot}${path.sep}`)) {
				await rm(publishedPath, { force: true });
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

const sourceFiles = (await findAgentDocs(docsRoot)).sort();
await mkdir(publicAgentDocsRoot, { recursive: true });
await removePreviouslyPublishedDocs();

const docs: AgentDocEntry[] = [];
for (const sourcePath of sourceFiles) {
	const relativeSource = path.relative(docsRoot, sourcePath).split(path.sep).join("/");
	const targetPath = path.join(publicAgentDocsRoot, relativeSource);

	await mkdir(path.dirname(targetPath), { recursive: true });
	await copyFile(sourcePath, targetPath);
	docs.push({
		source: relativeSource,
		url: `/agent-docs/${relativeSource}`,
	});
}

const manifest: AgentDocManifest = {
	schemaVersion: 1,
	docs,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Published ${docs.length} agent doc${docs.length === 1 ? "" : "s"} to /agent-docs`);
