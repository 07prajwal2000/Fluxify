import { $, write } from "bun";
import path from "path";

async function setupHooks() {
	const gitDir = path.join(process.cwd(), ".git");
	const hooksDir = path.join(gitDir, "hooks");
	const preCommitPath = path.join(hooksDir, "pre-commit");

	try {
		const isGitRepo = await Bun.file(path.join(gitDir, "HEAD")).exists();
		if (!isGitRepo) {
			console.log("Not a git repository, skipping git hooks setup.");
			return;
		}

		const hookScript = `#!/bin/sh\nbun run scripts/precommit.ts\n`;
		await write(preCommitPath, hookScript);

		if (process.platform !== "win32") {
			await $`chmod +x ${preCommitPath}`;
		}

		console.log("Git hooks configured successfully.");
	} catch (e) {
		console.error("Failed to setup git hooks:", e);
	}
}

setupHooks();
