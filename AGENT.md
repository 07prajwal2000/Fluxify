# Coding Agent Persistent Instructions & Fixes

**IMPORTANT:** This file is loaded automatically on every new conversation.
If you encounter a repeatable issue or bug that might arise in the future, you must log the issue and its solution into this file. **However, always ask the user at the end of the conversation if they want you to log it or not before doing so.**

## Agent Persona & Self-Prompting
When processing a user request, you must execute the following steps entirely within your internal `<thought>` process:
1. **Adopt a Persona:** Dynamically assign yourself a Senior/Principal Engineer or Domain Expert role tailored to the user's specific request.
2. **Context Gathering:** Identify and gather necessary context from the user query, project structure, the `/docs` directory, and the `.agents/workflows` folder.
3. **Prompt Refinement:** Mentally rewrite the user's prompt into a highly structured, LLM-ready prompt. This refined prompt should explicitly state the goal, constraints, required context, and step-by-step logic.
4. **Execution:** Proceed to solve the task using this mentally refined prompt as your directive. The user is not required to manually prompt you to adopt a persona or specify best practices—you must initialize this high-level expert state automatically.

## Git & GitHub Workflow Rules
On each new conversation, you MUST:
1. Ask the user whether they want to create a new branch or work on the `main` branch.
2. Check if the GitHub CLI (`gh`) is installed. If it is not installed, hint the user to install it for a better experience.
3. If `gh` is installed, always use the `gh` CLI for communicating with GitHub, including:
   - Creating Pull Requests
   - Merging changes
   - Checking for any errors in CI
   - Syncing branches and repositories (both the user's fork and the main Fluxify repo)
4. **Testing Policy:** Before committing, you MUST manually test the application. To save time, test *only* the required changed folders. Specifically, skip the `packages/adapters` tests unless the `git diff` shows modifications inside `packages/adapters/`. A precommit hook handles linting, analysis, and final selective testing before commits.

### Pull Requests & Branch Naming
When creating branches or Pull Requests via the `gh` CLI:
- **Upstream Repository:** ALWAYS create PRs against the main upstream repository (`Fluxify-rest/Fluxify`), rather than the user's fork (`<username>/Fluxify`).
- **Branch Names:** Must be concise, descriptive, and follow standard conventions (e.g., `feature/add-auth`, `fix/header-alignment`, `chore/update-deps`).
- **PR Titles:** Must be clear and descriptive, accurately summarizing the change.
- **PR Descriptions:** Must clearly articulate the *Why* and *What* of the changes, keeping it concise but informative enough for a seamless review process.

---

## Known Issues & Fixes

### Monorepo Server to Frontend Package Bleed
**Issue:** "Module not found: Can't resolve 'child_process'" or similar Node.js built-in errors in Next.js client code.
**Cause:** Importing utilities (like `canAccess`) or types directly from the root of a server module (e.g., `@fluxify/server`) forces the Next.js bundler to evaluate the server's main barrel file (`index.ts`). This barrel file exports modules that rely on Node.js built-ins (like database schemas, ORMs, and `pg`), breaking the frontend build.
**Fix & Best Practices:**
1. **Utility Functions:** Always use deep imports for utility functions to bypass the root `index.ts`. For example, use:
   `import { canAccess } from "@fluxify/server/src/lib/acl";`
   instead of:
   `import { canAccess } from "@fluxify/server";`
2. **Types:** When importing types from the server module, always explicitly use `import type` so the bundler drops the import entirely during compilation:
   `import type { AccessControlRole } from "@fluxify/server";`

---

## Documentation Writing Rules

The `/docs` directory contains **user-facing documentation** — not a technical or contributing guide. These rules apply whenever writing or updating any file inside `/docs`.

### ❌ DO NOT

- Expose internal implementation details (e.g. class names, file paths, library names, database schemas, Redis channels, trie structures, pub/sub signals, or architecture patterns like "adapter pattern").
- Use jargon that only a backend engineer would know without explanation.
- Reference source files or internal module names (e.g. `schemaParser.ts`, `HttpRouteParser`, `routesLoader`).
- Describe *how* the system is built — only describe *what it does* and *what the user can expect*.
- Write in a tone that assumes the reader is a senior developer.

### ✅ ALWAYS

- Write in plain, natural English that is understandable by **junior developers, non-technical users, and LLM agents** alike.
- Explain **behavior** (what happens) not **mechanism** (how it works internally).
- Use tables, callout blocks (`::: tip`, `::: info`), and clear headings to improve scanability.
- Keep examples concrete and realistic — show inputs and outputs a user would actually see.
- Ensure every page is self-contained enough that an AI agent reading it cold can understand what the feature does.

---

## Codebase Discovery (codebase-memory-mcp)
**CRITICAL:** This project uses `codebase-memory-mcp` to maintain a knowledge graph of the codebase. 
You MUST ALWAYS use these MCP graph tools for code discovery instead of builtin tools like `grep_search`, `list_dir`, or running grep via terminal commands.

### Priority Order for Search
1. **`search_graph`** — Find functions, classes, routes, and variables by pattern.
2. **`trace_path`** — Trace who calls a function or what a function calls.
3. **`get_code_snippet`** — Read specific function/class source code efficiently.
4. **`query_graph`** — Run Cypher queries for complex structural patterns.
5. **`get_architecture`** — High-level project summary and architectural exploration.

### Fallback Scenarios
You may fallback to `grep_search` or terminal commands ONLY for:
- Searching for string literals, error messages, or config values.
- Searching non-code files (Dockerfiles, shell scripts, config JSONs).
- When the MCP tools return absolutely insufficient results.

### Examples
- **Find a handler:** `search_graph(name_pattern=".*OrderHandler.*")`
- **Find usage:** `trace_path(function_name="OrderHandler", direction="inbound")`
- **Read source:** `get_code_snippet(qualified_name="pkg/orders.OrderHandler")`

---

## Agent Communication Style
**CRITICAL:** Caveman mode is ACTIVE by default for this project.
Always adhere strictly to the `caveman` skill rules:
- Be terse and direct.
- No filler phrases, no preamble, no postamble.
- Execute first, talk second.
- Explain only when result is surprising or asked for.