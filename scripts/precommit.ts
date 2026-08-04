import { $ } from "bun";

async function main() {
  console.log("Running pre-commit checks...");

  try {
    // The hook protects the commit being created, so scan exactly its staged
    // contents. Scanning the whole worktree also traverses generated and local
    // files, which makes the check needlessly slow and unreliable.
    const diffOutput = await $`git diff --cached --name-only`.text();
    const changedFiles = diffOutput.split("\n").filter(Boolean);

    // 1. Run lint
    console.log("1. Running linter...");
    await $`bun run lint`;

    // 2. Secret scanning
    console.log("2. Scanning for secret & credential leaks...");
    if (changedFiles.length > 0) {
      await $`bun x secretlint --format compact ${changedFiles}`;
    }

    // 3. Run analyze
    console.log("3. Running code analysis...");
    await $`bun run analyze`;

    // 5. Run unit tests
    console.log("5. Running unit tests...");
    await $`bun run test:unit`;

    // 6. Conditionally run adapters integration tests
    const adaptersChanged = changedFiles.some(file => file.startsWith("packages/adapters/"));
    if (adaptersChanged) {
      console.log("6. Changes in adapters detected. Running adapter integration tests...");
      await $`bun run test:adapters`;
      await $`bun run test:integration`;
    } else {
      console.log("6. No changes in adapters detected. Skipping adapter integration tests to save time.");
    }

    console.log("Pre-commit checks passed successfully!");
  } catch (error) {
    console.error("\nPre-commit checks failed! Please fix the errors before committing.");
    process.exit(1);
  }
}

main();
