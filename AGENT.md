# Coding Agent Persistent Instructions & Fixes

**IMPORTANT:** This file is loaded automatically on every new conversation.
If you encounter a repeatable issue or bug that might arise in the future, you must log the issue and its solution into this file. **However, always ask the user at the end of the conversation if they want you to log it or not before doing so.**

## Agent Persona & Self-Prompting
When processing a user request, you must execute the following steps entirely within your internal `<thought>` process:
1. **Adopt a Persona:** Dynamically assign yourself a Senior/Principal Engineer or Domain Expert role tailored to the user's specific request.
2. **Context Gathering:** Identify and gather necessary context from the user query, project structure, the `/docs` directory, and the `.agents/workflows` folder.
3. **Prompt Refinement:** Mentally rewrite the user's prompt into a highly structured, LLM-ready prompt. This refined prompt should explicitly state the goal, constraints, required context, and step-by-step logic.
4. **Execution:** Proceed to solve the task using this mentally refined prompt as your directive. The user is not required to manually prompt you to adopt a persona or specify best practices—you must initialize this high-level expert state automatically.

## Runtime & Package Management
**CRITICAL:** Always use `bun` as the runtime for this project. 
- Use `bun run`, `bun install`, `bun test`, etc.
- Do not use `npm`, `yarn`, or `pnpm` unless explicitly instructed otherwise.
- Use `bun` to execute JavaScript/TypeScript files.

## Git & GitHub Workflow Rules
On each new conversation, you MUST:
1. Ask the user whether they want to create a new branch or work on the `main` branch.
2. Check if the GitHub CLI (`gh`) is installed. If it is not installed, hint the user to install it for a better experience.
3. If `gh` is installed, always use the `gh` CLI for communicating with GitHub, including:
   - Creating Pull Requests
   - Viewing/Managing Issues & Discussions
   - Merging changes & checking CI errors
   - Syncing branches and repositories
4. **Remote Repository Target:** ALWAYS use `Fluxify-rest/Fluxify` for Pull Requests, Issues, and anything related to the remote repository (e.g., `gh issue view <id> --repo Fluxify-rest/Fluxify`, `gh pr create --repo Fluxify-rest/Fluxify`).
5. **Pushing Code:** Only use the local repository and the user account's forked repository for pushing code (`git push origin <branch-name>`).
6. **Testing Policy:** Before committing, you MUST manually test the application. To save time, test *only* the required changed folders. Specifically, skip the `packages/adapters` tests unless the `git diff` shows modifications inside `packages/adapters/`. A precommit hook handles linting, analysis, and final selective testing before commits.

### Pull Requests & Branch Naming
When creating branches or Pull Requests via the `gh` CLI:
- **Upstream Repository:** ALWAYS target `Fluxify-rest/Fluxify` for PRs, Issues, and remote repo interactions, while pushing branches to the user's forked repo.
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

### Provider `invalid_request_message_order` 400s ("got assistant/system")
**Golden rule:** A chat request's **last message must be `user` or `tool`** (or an `assistant` message explicitly marked as a prefix). Mistral (and some others) hard-reject anything else with `400 invalid_request_message_order`. Never send a message array whose final element is an `AIMessage`/assistant or a `SystemMessage`.

**Live bug (ai-gateway harness — the one users actually hit):**
- Symptom: Discussion agent answered correctly on call 1, then a redundant call 2 with the assistant reply appended 400'd.
- Root cause: `apps/ai-gateway/src/harness/models/base.ts` → `invokeAgent`. Its tool loop pushes the model's final free-text `AIMessage` onto `finalMessages` and `break`s; with no `zodSchema` the code then fell through to a **second** `originalModel.invoke(finalMessages)` at the end of the method — re-sending a request that now ended with the assistant message.
- Fix: when the tool loop gets a tool-call-free response and there's no `zodSchema`, **`return response` directly** — do not re-invoke. (The end-of-method `invoke` is only correct for the no-tools path, where history still ends with the human `userQuery`.)

**Sibling bug (apps/server graph — legacy path, also fixed):**
- `apps/server/src/lib/ai/nodes/discussion.ts` read `createAgent(prompt, []).invoke(...).structuredResponse`, but `createAgent` had no `responseFormat`, so `structuredResponse` is **always `undefined`** (langchain v1.5 `AgentNode`: no `responseFormat` → returns plain `AIMessage`, never sets `structuredResponse`). That threw in `withRetry`, forcing a retry every time; and `withRetry` appended its correction as `["system", ...]` (non-user last message) → 400.

**Rules — read before writing/reviewing ANY new AI agent or graph node:**
1. **Never re-invoke a model with an assistant/system message last.** If you already have the final `AIMessage`, return it; don't send it back in.
2. **Match the canonical shape.** `apps/server` nodes (`classifier`/`planner`/`builder`) use `modelFactory.createModel()` + `model.invoke(history)` + `response.content.toString()`, with history `[...messages, ["system", systemPrompt], ["human", userPrompt]]` (ends on the human turn). Copy it; don't invent a new shape.
3. **Only read `.structuredResponse`** if you actually passed a `responseFormat` to `createAgent` (the `packages/adapters/ai/*` adapters do NOT). Otherwise get JSON via `<output_format>` in the prompt + `withRetry(schema, ...)`.
4. **Only use `createAgent`/tool-bound models when you pass real tools.** `[]` tools + `structuredResponse` gives neither tool use nor structured output.
5. **Retry corrections must be a `["human", ...]` turn**, never `["system", ...]`, so the retried request still ends on a user role (`apps/server/src/lib/agentRetry.ts`).

### React Aria / HeroUI Table Checkbox `slot="selection"` & PressResponder Errors
**Issue:**
1. `Error: A slot prop is required. Valid slot names are "selection"` on `<Checkbox>` inside a `<Table>` component.
2. `Warning: A PressResponder was rendered without a pressable child` when placing a `<button>` inside `<Table.Column>`.
**Cause:**
1. React Aria / HeroUI Table expects selection checkboxes rendered inside `<Table.Header>` or `<Table.Cell>` to explicitly declare `slot="selection"`.
2. `<Table.Column>` is already rendered as an interactive ColumnHeader by React Aria, so embedding a native `<button>` creates conflicting PressResponders.
**Fix:**
1. Pass `slot="selection"` on any `<Checkbox>` rendered inside `<Table.Header>` or `<Table.Cell>` (e.g. `<Checkbox slot="selection" ... />`).
2. Replace nested `<button>` elements inside `<Table.Column>` with clickable `<div>` or `<span>` elements (e.g. `<div role="button" tabIndex={0} onClick={...}>`).

### Harness Structured Output — "JSON Parse error: Unexpected EOF" / silent parse failures
**File:** `apps/ai-gateway/src/harness/models/base.ts` (`fallbackStructuredOutput`).
**Symptoms & causes (all fixed, keep the fixes):**
1. `Model response: .` (empty) — `response.content as string` assumed a plain string. Reasoning/multi-block models return an **array of content blocks**, or park text in `additional_kwargs.reasoning_content`. Use `extractText()`; never cast `.content` to string.
2. Empty content also happens when a model burns its whole output budget on thinking. It throws a named error now — don't let it reach `JSON.parse`.
3. Prose around the payload ("Here is the JSON: {...}") — `cleanJsonOutput` strips code fences AND slices from the first `{`/`[` to the last `}`/`]`.
4. `"field": null` for an omitted optional field — zod `.optional()` **rejects null**. Two defenses: `JSON.parse` reviver drops nulls, and agent schemas use `.nullish()` instead of `.optional()`.
**Rules:**
- Prefer `.nullish()` over `.optional()` in any zod schema an LLM fills.
- Give required arrays `.default([])` — a terminal block has no `connections`, a fresh canvas has no `canvasChanges`; making the model type `[]` is just an error surface.
- Every agent prompt must include an **Output Contract** with the exact property names and a concrete JSON example. Field-name drift (`type` vs `blockType`) is a prompt bug, not a model bug.

### Harness Retries — a blind retry makes the model repeat the same mistake
`withRetry` re-sends an identical prompt, so schema violations recur every attempt. `fallbackStructuredOutput` retries internally instead: it appends the bad output as an `AIMessage` plus the compact zod issue list as a **`HumanMessage`** correction, then re-asks (3 attempts). The correction must be a human turn — see the `invalid_request_message_order` rules above.
Also: native `withStructuredOutput` failures are caught and fall through to the prompt fallback rather than killing the run.

### Harness "The operation timed out." / run hangs
- Every model+tool call goes through `withSignal()`, which injects `MODEL_CALL_TIMEOUT_MS` (180s, override with `HARNESS_MODEL_TIMEOUT_MS`) so a stuck provider connection can't stall a run. `checkConnection` uses 30s.
- The tool-execution loop's `model.invoke` must be wrapped in `withRetry` like every other model call — it was the one unretried call, so a single network blip killed the whole run.
- `isUserInterrupt(error)` returns true for **any** `AbortError`, including provider-side timeouts. Only treat it as a user stop when `abortController.signal.aborted` is also true; otherwise a timeout gets recorded as `interrupted` instead of `failed`.

### Harness Runs Marked `failed` With No Message / after correct output
1. **No message:** `failRun` used to persist only `status: "failed"` with no `aiResponse`, so the UI showed a bare status. The graph catch now passes `describeFailure(error, lastNode)` — a categorized, user-readable markdown message (structured output / rate limit / auth / context length / timeout / generic) naming the node that failed via `labelForNode`. `lastNode` is tracked from `on_chain_start` events. Non-`Error` rejections go through `errorMessage()` so `{ code: 23 }` doesn't become `[object Object]`.
2. **Failed right after producing correct output:** LangGraph's default `recursionLimit` is **25**. Each task level costs 3 supersteps (sub-agent → supervisor → orchestrator) plus ~5 for router/verify/planner/taskGenerator/orchestrator, so a 6–7 task sequential build throws `GraphRecursionError` at the very end. `streamConfig` sets `recursionLimit: 100`.

### "OpenAI Compatible" Integration — "Missing credentials. Please pass an apiKey…"
**Issue:** Selecting the *OpenAI Compatible* AI variant (Ollama, LM Studio, vLLM, LiteLLM) failed the pre-run connection probe with `Missing credentials…set the OPENAI_API_KEY environment variable`.
**Cause:** That variant maps to provider `openai` (`models/projectConfig.ts`), and local servers need no API key — but the OpenAI SDK refuses to construct without one.
**Real cause (the one that bites with a valid key too):** the wrapper passed **`openAIApiKey`**. In `@langchain/openai` v1.x, `ChatOpenAI` reads only `fields.apiKey`, `fields.configuration.apiKey`, or `$OPENAI_API_KEY` — `openAIApiKey` is a dead alias on chat models (it still works on `OpenAI()`/`OpenAIEmbeddings`), so the key was silently dropped for every OpenAI-family provider (DeepSeek, Poolside, etc.).
**Field-name check per SDK (verified in node_modules, not guessed):** `ChatOpenAI` → `apiKey` only. `ChatAnthropic` → `apiKey` (`anthropicApiKey` still aliased; base URL is `anthropicApiUrl`, NOT `baseUrl`). `ChatGoogle`, `ChatMistralAI`, `ChatOpenRouter` → `apiKey`. When bumping a LangChain package, re-check these — the aliases die quietly with no type error.
**Fix (`models/openai/index.ts`):**
- `apiKey: this.apiKey || (this.baseUrl ? "not-required" : undefined)` — a placeholder only when a custom `baseUrl` is set; real OpenAI still requires a real key.
- `supportsStructuredOutput()` returns `false` when `baseUrl` is set. Compatible servers usually reject the `json_schema` response format, so skip the native path and use the prompt fallback instead of burning 3 retries per call.

### Harness Orchestrator — skipped/repeated task levels
**Issue:** Sub-agents appeared to run twice (e.g. block builder inside block builder) and levels got skipped.
**Cause:** The orchestrator popped `taskQueue` to pick the next level, so any re-entry into that node consumed a level it never verified. Worse, the supervisor only wrote statuses to `dispatchedTasks[i]`, relying on those being the *same object references* as entries in `tasks` — a fragile aliasing contract across graph state.
**Fix:**
- The orchestrator derives the ready level from task statuses + `dependsOnAgentId` (`status === "pending"` and every dependency settled). A `running` task is never dispatched again. `taskQueue` is now informational only.
- The supervisor writes each verdict into the `tasks` entry **by id** (`setStatus`), not through reference aliasing. A lost write there stalls the build forever.

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

## Codebase Discovery (Hybrid Approach)
**CRITICAL:** This project uses `codebase-memory-mcp` alongside native tools. Mix and match to achieve the best results:
- **Use `codebase-memory-mcp`** (e.g., `search_graph`, `query_graph`, `trace_path`) for semantic search, finding functions/classes/routes by keyword or pattern, and understanding code relationships. It excels at glob searching and deep code structure.
- **Use Native Tools** (e.g., `list_dir`, `view_file`, `grep_search`) for exploring physical folder structure, reading exact file contents, or simple text lookups.

### When to use which:
- **`codebase-memory-mcp` tools:** Finding a specific handler, tracing where a function is called, exploring architecture, or searching for keywords across the knowledge graph.
- **`list_dir`:** Understanding the physical directory structure or finding where a new component should be placed.
- **`view_file`:** Reading the full contents of a specific file once located.
- **`grep_search`:** Finding string literals, error messages, or config values in non-code files.

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