import { $ } from "bun";

async function main() {
	console.log("Running pre-commit checks...");

	try {
		// 1. Format and lint the staged files. Biome rewrites them in place, so
		// they are staged again afterwards and the fixes land in this commit.
		console.log("1. Formatting and linting staged files...");
		const staged = (
			await $`git diff --cached --name-only --diff-filter=ACMR`.text()
		)
			.split("\n")
			.filter(Boolean);
		if (staged.length > 0) {
			await $`bun x biome check --write --no-errors-on-unmatched --files-ignore-unknown=true ${staged}`;
			await $`git add -- ${staged}`;
		}

		// 2. Typecheck
		console.log("2. Running typecheck...");
		await $`bun run typecheck`;

		// 3. Run analyze
		console.log("3. Running code analysis...");
		await $`bun run analyze`;

		// 4. Run unit tests. Integration and e2e tests need live services and run
		// in CI on every PR and push instead.
		console.log("4. Running unit tests...");
		await $`bun run test:unit`;

		console.log("Pre-commit checks passed successfully!");
	} catch {
		console.error(
			"\nPre-commit checks failed! Please fix the errors before committing.",
		);
		process.exit(1);
	}
}

main();
