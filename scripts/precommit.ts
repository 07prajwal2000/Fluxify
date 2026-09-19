import { $ } from "bun";

async function main() {
  console.log("Running pre-commit checks...");

  try {
    // 1. Run lint
    console.log("1. Running linter...");
    await $`bun run lint`;

    // 2. Run analyze
    console.log("2. Running code analysis...");
    await $`bun run analyze`;

    // 3. Run unit tests. Integration and e2e tests need live services and run
    // in CI on every PR and push instead.
    console.log("3. Running unit tests...");
    await $`bun run test:unit`;

    console.log("Pre-commit checks passed successfully!");
  } catch (error) {
    console.error("\nPre-commit checks failed! Please fix the errors before committing.");
    process.exit(1);
  }
}

main();
