# Coding Agent Persistent Instructions & Fixes

**IMPORTANT:** This file is loaded automatically on every new conversation.
If you encounter a repeatable issue or bug that might arise in the future, you must log the issue and its solution into this file. **However, always ask the user at the end of the conversation if they want you to log it or not before doing so.**

## Runtime & Package Management
**CRITICAL:** Always use `bun` — `bun run`, `bun install`, `bun test`, and `bun` to execute JS/TS files. Never `npm`, `yarn`, or `pnpm`.

## Frontend Location — `apps/portal` ONLY
**CRITICAL:** The frontend is `apps/portal`. **`apps/web` is LEGACY — never edit it.**
- Do not add, modify, or "fix" anything under `apps/web`, even when a file there
  looks like exactly the thing the task describes. It is the older Next.js app
  and is not the shipping UI.
- Both apps contain same-named components for the same features (block settings
  panels, conditions editors, integration selectors). Matching a filename is NOT
  evidence you are in the right app — check the path prefix first.
- `apps/web` also has `"lint": ""` in its `package.json`, so `bun run lint`
  reports success without typechecking it. A green lint does not mean work there
  was validated.
- Portal specifics worth knowing before searching: shared UI lives in
  `packages/components` (HeroUI, e.g. `ConditionsBuilder`, `JsTextField`),
  block settings panels in `apps/portal/src/components/canvas/panel/blocks/`,
  and database introspection is already available via `useDbMetadata`
  (`tableNames` / `getColumnsForTable` / `allColumns`). Check these before
  building a new component — the equivalent usually already exists.

## Git & GitHub Workflow Rules
- **Two remotes, and they are not interchangeable.** Issues, discussions and PRs always target **`Fluxify-rest/Fluxify`** (`--repo Fluxify-rest/Fluxify`). Branches are only ever pushed to the user's fork, `origin` (`git push origin <branch>`). A PR from the fork needs `--head <user>:<branch>`.
- Use the `gh` CLI for everything GitHub — PRs, issues, CI status, merges.
- Ask at the start of a conversation whether to branch or work on `main`.
- **Testing before commit:** test only the folders that changed. Skip `packages/adapters` tests unless `git diff` shows changes inside it. The pre-commit hook runs lint, a secret scan, FTA analysis and tests — **never `--no-verify`**; if it fails, fix the cause (see the FTA section below).
- Branch names follow convention (`feat/…`, `fix/…`, `chore/…`). PR descriptions say *why* and *what*.
- **Writing a multi-line commit message:** use `git commit -F -` with a bash heredoc. The PowerShell `@'…'@` form silently becomes a literal `@` subject line when run through the Bash tool.

---

## Known Issues & Fixes

### ⚠️ CRITICAL — Never Hardcode Colors in Portal UI
**Issue:** New portal pages render unthemed — wrong background, invisible text, borders that vanish — because the markup carries literal hex values (`bg-[#12151D]`, `border-[#1E232F]`, `text-[#D0F237]`, `bg-[#ccff00]`) or Tailwind's default palette (`text-zinc-400`, `text-white`, `text-black`, `bg-white/[0.04]`). These are frozen dark-theme values: they ignore `--accent`, do not flip under `.light` / `[data-theme="light"]`, and drift from the design system the moment a token changes.
**Cause:** Copying an existing page as a starting point. Several older files still contain hardcoded hex, so the wrong pattern looks like the house style. **A hex value in a neighbouring file is NOT precedent — it is unconverted debt.**
**Fix & Best Practices:**
1. **Always use the semantic utility classes.** The theme is defined in `packages/components/src/styles.css` as CSS variables; the Tailwind utilities built on them are the only supported way to colour portal UI:
   - Surfaces: `bg-background`, `bg-background-secondary`, `bg-surface`, `bg-surface-secondary`, `bg-overlay`
   - Text: `text-foreground`, `text-muted`, `text-muted-foreground`, `text-accent`, `text-accent-foreground`
   - Lines & rings: `border-border`, `border-accent`, `ring-accent`, `ring-focus`
   - Status: `text-danger`, `text-success`, `bg-warning` (and their `border-*` / `bg-*` forms)
2. **Never write `text-white` / `text-black` / `text-zinc-*` / `bg-white/[0.04]`.** Map them: primary text → `text-foreground`, secondary text → `text-muted`, hover wash → `hover:bg-surface-secondary`, selected wash → `bg-accent/10`, hairline ring → `ring-border`.
3. **The lime accent is `--accent`, never a literal.** `#ccff00` / `#D0F237` → `bg-accent` with `text-accent-foreground` (the accent needs dark text for contrast; `text-accent-foreground` already encodes that).
4. **Prefer the component over restyling a native element.** A lime CTA is `<Button variant="primary">`, not a `<button>` with an accent background pasted on — the variant already tracks the theme.
5. **Opacity modifiers on a token are fine** (`bg-accent/10`, `text-muted/50`); they stay theme-aware. Literal rgba/hex overlays are not.
6. **Check before committing any portal UI:**
   `grep -nE "(bg|text|border|ring)-\[#|zinc-[0-9]|text-(white|black)" <changed files>` — this must return nothing.

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

### React Aria / HeroUI Table Checkbox `slot="selection"` & Theme Compatibility
**Issue:**
1. Default HeroUI v3 `<Checkbox>` fails to render properly or breaks contrast in custom themes (light/dark mode) due to strict subcomponent structure expectations and unstyled SVG icon defaults.
2. `Error: A slot prop is required. Valid slot names are "selection"` on `<Checkbox>` inside a `<Table>` component.
3. `Warning: A PressResponder was rendered without a pressable child` when placing a `<button>` inside `<Table.Column>`.

**Cause:**
1. HeroUI v3 Checkbox requires specific compound component wrapping (`Checkbox.Root`, `Checkbox.Control`, `Checkbox.Indicator`) and theme tokens; unstyled or raw usage breaks contrast/layout in dark/light themes.
2. React Aria / HeroUI Table expects selection checkboxes rendered inside `<Table.Header>` or `<Table.Cell>` to explicitly declare `slot="selection"`.
3. `<Table.Column>` is already rendered as an interactive ColumnHeader by React Aria, so embedding a native `<button>` creates conflicting PressResponders.

**Fix & Best Practices:**
1. **Always use `@fluxify/components` Checkbox:** Use `import { Checkbox } from "@fluxify/components"` located in `packages/components/src/Checkbox`. It is self-contained, fully typed without `any`, uses theme CSS variables (`var(--accent)`, `var(--accent-foreground)`, `var(--border)`, `var(--surface)`, `var(--focus)`) for light/dark theme compatibility, handles `checked`, `indeterminate`, `size`, `variant`, `label`, `description`, `errorMessage`, and supports `forwardRef`. Additionally, ALWAYS use this `Checkbox` component for UI toggle switches instead of importing or using a standalone `Switch` component.
2. **Table Selection:** Pass `slot="selection"` on any `<Checkbox>` rendered inside `<Table.Header>` or `<Table.Cell>` (e.g. `<Checkbox slot="selection" ... />`).
3. Replace nested `<button>` elements inside `<Table.Column>` with clickable `<div>` or `<span>` elements (e.g. `<div role="button" tabIndex={0} onClick={...}>`).

### Unified Delete & Delete Icon Buttons (`DeleteIconButton` & `DeleteButton`)
**Rule:** ALWAYS use the unified `@fluxify/components` delete button components for delete and remove actions across the portal UI instead of ad-hoc `<Button variant="ghost">` or solid `<Button variant="danger">`:
1. **Icon-only delete actions (table rows, card actions, form removals):** Use `<DeleteIconButton aria-label="Delete ..." onPress={...} />` (or pass custom `icon`, `size`, `isDisabled`, `iconSize`). It uses `variant="danger-soft"` (translucent danger styling) by default.
2. **Text delete actions (bulk delete buttons, danger zone action buttons):** Use `<DeleteButton onPress={...}>Delete ...</DeleteButton>` (uses `variant="danger-soft"` with leading `TbTrash` icon by default).
3. **Confirmation dialogs:** Use `<ConfirmDialog danger ...>` which defaults destructive action buttons to `variant="danger-soft"` (translucent danger) unless explicitly given `variant="danger"`.
4. **Dropdown menu delete items:** Style with `variant="danger" className="text-danger hover:bg-danger/10 focus:bg-danger/10 focus:text-danger"` and `<TbTrash size={16} className="text-danger" />`.

### Unified Modal Close Button (`CloseButton` / `ModalCloseButton`)
**Rule:** ALWAYS use the unified `@fluxify/components` close button component for modals, dialogs, and clearable surfaces across the portal and components UI instead of default HeroUI `<Modal.CloseTrigger>` (which renders an unthemed solid background and custom SVG) or ad-hoc custom icon buttons:
1. **Modal headers:** Use `<CloseButton />` (or `<ModalCloseButton />`) in `<Modal.Header>` (with flex layout, e.g. `<Modal.Header className="flex flex-row items-center justify-between">`). It uses `TbX` from `react-icons/tb` (default 18px), applies theme tokens (`text-muted hover:text-foreground hover:bg-surface-secondary active:bg-surface-secondary/80 rounded-md transition-colors`), and sets `slot="close"` for automatic modal dismissal with React Aria.
2. **Explicit close triggers:** When a manual dismissal callback is needed (e.g. outside dialog context or controlled state resets), pass `onPress={onClose}` (e.g. `<CloseButton onPress={handleClose} />`).
3. **Clearable input controls:** Use `<CloseButton aria-label="Clear ..." onPress={handleClear} />` for consistent clear actions in search/selector bars.

### Harness Structured Output — "Unrecognized token '\'" / "Unexpected EOF" / silent parse failures
**File:** `apps/ai-gateway/src/harness/models/base.ts` (`fallbackStructuredOutput`, `cleanJsonOutput`, `sliceBalancedJson`, `parseJsonLoose`).

**First line of defence is JSON mode, not the parser.** `jsonModeOptions()` is a per-provider hook, bound **only** on the prompt-fallback path (`model.bind(...)`): OpenAI / OpenRouter / Mistral → `response_format: { type: "json_object" }`, Ollama → `format: "json"`, Anthropic/Google → none (they use the native path). Constrained decoding is what stops prose, `\boxed{}`, and escaped payloads at the source — every repair below is only a net. Do **not** bind it on the native `withStructuredOutput` path (that already sends `json_schema`). If a provider rejects `response_format` outright (some OpenRouter upstreams, older compatible servers), the loop detects "no response came back at all" and drops the constraint for the remaining attempts instead of burning all 3 on the same 400.

**Symptoms & causes (all fixed, keep the fixes):**
1. `Model response: .` (empty) — `response.content as string` assumed a plain string. Reasoning/multi-block models return an **array of content blocks**, or park text in `additional_kwargs.reasoning_content` (DeepSeek), `additional_kwargs.reasoning` (OpenRouter), or a `thinking` block. Use `extractText()`; never cast `.content` to string.
2. Empty content also happens when a model burns its whole output budget on thinking. It throws a named error now — don't let it reach `JSON.parse`.
3. **`JSON Parse error: Unrecognized token '\'`** — the model returned the payload as a *quoted, escaped JSON string* (`"{\"blocks\":[]}"`). The old slice-from-first-`{` cut the opening quote and left the escapes behind. `cleanJsonOutput` now unwraps a fully quoted string (`JSON.parse` it once, keep the inner string) **before** slicing, and `parseJsonLoose` retries once with `\"` → `"` for the unquoted variant (`{\"blocks\":[]}`).
4. Prose/extra braces around the payload — **never use `lastIndexOf("}")`**. It guesses wrong the moment the model appends a brace of its own (`… } {see above}`, `\boxed{{…}}`) or a string *value* contains `}`. `sliceBalancedJson()` counts braces string-aware and returns the first complete value; `null` (no braces / truncated) falls through to the raw content so the EOF error still surfaces to the retry loop.
5. `"field": null` for an omitted optional field — zod `.optional()` **rejects null**. Two defenses: the `JSON.parse` reviver drops nulls, and agent schemas use `.nullish()` instead of `.optional()`.

**Rules:**
- Prefer `.nullish()` over `.optional()` in any zod schema an LLM fills.
- Give required arrays `.default([])` — a terminal block has no `connections`, a fresh canvas has no `canvasChanges`; making the model type `[]` is just an error surface.
- Every agent prompt must include an **Output Contract** with the exact property names and a concrete JSON example. Field-name drift (`type` vs `blockType`) is a prompt bug, not a model bug.
- Adding a provider wrapper? Override `jsonModeOptions()` if its SDK exposes a JSON/response-format call option — **verify the field name in `node_modules`**, don't guess (see the field-name check in the "Missing credentials" section).

### Harness Temperature — always near-greedy
`HARNESS_TEMPERATURE = 0` (exported from `models/base.ts`) is passed by every wrapper. These agents emit JSON and graph edits, not prose; sampling variance is pure error surface and was a direct cause of intermittent schema drift. **Exception:** OpenAI reasoning models (`o1`/`o3`/`o4`/`gpt-5`, matched by `FIXED_TEMPERATURE_MODEL` in `models/openai/index.ts`) **400 on any temperature but the default** — omit the field entirely for those.

### Harness Retries — a blind retry makes the model repeat the same mistake
`withRetry` re-sends an identical prompt, so schema violations recur every attempt. `fallbackStructuredOutput` retries internally instead: it appends the bad output plus the compact zod issue list as a **`HumanMessage`** correction, then re-asks (3 attempts). The correction must be a human turn — see the `invalid_request_message_order` rules above.

**Echo the model's own message back, not a rebuilt one — but strip its tool calls.** The correction turn uses `asHistoryMessage()` (in `models/toolLoop.ts`), which returns the original `AIMessage` so provider-specific reasoning (`reasoning_content`, thinking blocks) travels with it. Constructing `new AIMessage(cleanedText)` throws the reasoning away and attempt 2 just re-derives — and re-botches — the same answer. When the response has no textual content, it rebuilds with the extracted reasoning text and preserves `additional_kwargs`.

**The one thing that must NOT travel with it is `tool_calls`.** Symptom: `Failed to parse structured output after 3 attempts. Error: 400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`. The model answers the structured-output call with a *tool call* instead of JSON (so attempt 1 throws "empty response" — a tool-call-only reply has no text), that message is echoed into the correction turn with its tool calls intact, and a `HumanMessage` is appended after it. An assistant message carrying `tool_calls` that no `ToolMessage` answers is rejected outright, so attempts 2 and 3 both 400 **on the history, not on the answer** — the whole retry budget is spent without the model ever getting a real chance to correct itself (~30-40k tokens on one observed run).

Strip both copies: the `AIMessage.tool_calls` field *and* `additional_kwargs.tool_calls`, where OpenAI-compatible providers keep their own. The model at that point is unbound and has no tools to call anyway. Give the rebuilt message real content saying the tool call was discarded — `"(empty response)"` tells the model nothing about what it did wrong.

**General rule:** any time a message is moved, echoed, replayed, or summarized into a new request, an assistant message's `tool_calls` and the `ToolMessage`s answering them must stay together or both be dropped. Splitting them is always a 400.

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
- `supportsStructuredOutput()` returns `false` when `baseUrl` is set. Compatible servers usually reject the `json_schema` response format, so skip the native path and use the prompt fallback instead of burning 3 retries per call. That fallback still constrains output via `json_object` (`jsonModeOptions()`), which every OpenAI-compatible server honours — the two flags are deliberately separate.

### Harness Run State — a dead run must not lose what it built
A run that dies partway through used to lose everything, so "continue" restarted the whole build from the planner and re-paid for every task that had already succeeded.

- **Never persist an empty state on a terminal path.** `failRun` and `interruptRun` called `saveLiveState` with a hardcoded `workingMemory: {}` — erasing the accumulated state on exactly the event worth recovering from. They take the state from `HarnessCallbacks.snapshotState()` now. The graph never returns a final state on the failure path, so that snapshot is the only surviving record.
- **`RESUMABLE_NODES` (`harness/callbacks.ts`) decides where checkpoints land.** It held only `PLANNER` and `HUMAN_IN_THE_LOOP`, so nothing was saved after planning. `SUPERVISOR` is in it now because it is the only node that settles task statuses, and task statuses are what a resume reads.
- **Artifacts are immutable per run.** One user message is one run; an agent that wants to change something creates a new artifact rather than editing an existing one. Do NOT add a status field to a sub-artifact row — the run already has a status, and a second state machine would only have to be kept in sync with the first. `SummarizerState.subArtifactIds` maps task id to row so a later run can tell persisted work from work that only lived in a dead process.
- **Guard side effects, not rows.** Duplicate artifact rows across runs are expected and harmless; two real routes in the user's project are not. Before re-running a task, check `appliedAt`, never row existence.

### Harness Orchestrator — skipped/repeated task levels
**Issue:** Sub-agents appeared to run twice (e.g. block builder inside block builder) and levels got skipped.
**Cause:** The orchestrator popped `taskQueue` to pick the next level, so any re-entry into that node consumed a level it never verified. Worse, the supervisor only wrote statuses to `dispatchedTasks[i]`, relying on those being the *same object references* as entries in `tasks` — a fragile aliasing contract across graph state.
**Fix:**
- The orchestrator derives the ready level from task statuses + `dependsOnAgentId` (`status === "pending"` and every dependency settled). A `running` task is never dispatched again. `taskQueue` is now informational only.
- The supervisor writes each verdict into the `tasks` entry **by id** (`setStatus`), not through reference aliasing. A lost write there stalls the build forever.

### Canvas Readonly Mode Enforcement & Save Button Visibility
**Issue:** When the canvas is set to `readOnly`, block settings panel inputs could remain interactive if fields didn't check change tracking state, and the top-level Save button remained visible. Furthermore, disabling `elementsSelectable` prevented users from opening and inspecting block settings panels in read-only mode.
**Fix & Best Practices:**
1. **Readonly Settings Panel Inputs:** All settings panel controls (`BlockTextField`, `BlockJsTextField`, `BlockSelectField`, `ConditionsBuilder`, `FieldMapEditor`, `JavaScriptTextArea`, `BlockNameInput`, `BlockDescriptionField`) must check `useCanvasChanges().enabled` (`editable`) and set `isDisabled={!editable}` or `readOnly={!editable}`.
2. **Hide Save Button in Readonly Mode:** The header Save button must be conditionally rendered (`{!readOnly && <Button ...>Save</Button>}`) so no save trigger is accessible in read-only mode.
3. **Keep Elements Selectable:** Set `elementsSelectable={true}` on `<ReactFlow>` so users can still select nodes and open side panels to inspect block configurations in read-only mode, while keeping `nodesDraggable={!readOnly}`, `nodesConnectable={!readOnly}`, and `deleteKeyCode={null}` disabled.

### Pre-commit Blocks on FTA Complexity (`score-cap 70`)
The pre-commit hook runs `fta-cli --score-cap 70`, which **fails the commit** for any file scoring above 70 — including files you only touched, and including test files. FTA weights file length heavily, so a large file sits near the cap and a small addition tips it over.

- **Check before you commit, not after:** `bun x fta-cli --json <dir>` and compare against the same command on a stashed baseline (`git stash push -- <file>`). That tells you whether the debt is yours or pre-existing.
- **The fix is splitting or deduplicating, not `--no-verify`.** Two near-identical loops parameterized into one helper, or a cohesive group of functions moved to its own module, both drop the score properly. A helper added *inside* the same file barely moves it — the lines are still there.
- Some files already on `main` are over the cap, so a commit touching them fails on debt you did not create. Fix it in the same commit and say so in the message.

### Resolving a Merge Conflict in the GitHub Web Editor Ships Broken Code
**Issue:** `main` broke after two PRs that touched the same function were merged — `find_resource` threw `ReferenceError: searchBy is not defined` on every call, for every agent holding the tool. CI reported only a failing lint job.
**Cause:** The conflict was resolved in GitHub's web editor. That path runs **no** local hooks, so the pre-commit chain (lint → FTA analyze → selective tests) never executed. The resolution kept both sides' *bodies* — one PR's wrapper, the other's new logic — but dropped an identifier from the destructuring pattern the second PR had added. Nothing on the server catches a free identifier.
**Fix & Best Practices:**
1. **Never resolve a conflict in the GitHub web editor when both sides touched the same function.** Pull the branch, resolve locally, let the pre-commit hook run, then push.
2. After any merge you resolved by hand, run `bun run --cwd apps/<app> lint` (`tsgo --noEmit`) on `main` before assuming it is green. A failing lint job may be hiding a runtime break, not a style nit.
3. When two PRs edit one function, expect the conflict to land on the *signature*: verify every parameter each side added still exists in the merged destructuring/argument list.

### Drizzle `sql` Template — Interpolation Is Parameterized, `sql.raw()` Is Not
**Issue:** Reviewing whether user/LLM-supplied search terms in `harness/internal/dbService.ts` could be injected.
**Cause/behaviour (verified in `node_modules`, not assumed):** In the `sql` tagged template, literal pieces become `StringChunk`s and every **interpolated value** falls through to `escapeParam(idx, chunk)` → a `$1`-style bound parameter. A `Column` interpolates as an escaped identifier. `sql.raw()` is the **only** path that concatenates text into the query.
**Rules:**
1. `sql\`${column} = ${userValue}\`` is safe — never hand-quote or hand-escape the value, that only creates a double-escaping bug.
2. Treat any `sql.raw()` on a request-derived string as an injection finding.
3. Two things parameterization does **not** cover: values that are *syntax* for another parser (a `to_tsquery` string is bound safely but can still be a malformed tsquery → a runtime error), and `ilike(col, \`%${k}%\`)`, where user `%`/`_` act as LIKE wildcards. Bound ≠ harmless — bound means "cannot escape the value slot".
4. Postgres also errors outright on a type mismatch against a typed id column (`uuid = 'auth'`, `serial = 'auth'`). Where the caller swallows errors into `[]`, one ordinary keyword blanks the entire search — an availability bug, so guard id comparisons with a shape check before they reach the query.

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

## Codebase Discovery
Use `codebase-memory-mcp` (`search_graph`, `query_graph`, `trace_path`, `get_code_snippet`) to locate code, trace callers, or understand architecture — it answers in far fewer tokens than scanning files. Fall back to grep/glob/file reads for exact text, non-code files, or anything the graph does not cover.

---

## Agent Communication Style
**CRITICAL:** Caveman mode is ACTIVE by default for this project.
Always adhere strictly to the `caveman` skill rules:
- Be terse and direct.
- No filler phrases, no preamble, no postamble.
- Execute first, talk second.
- Explain only when result is surprising or asked for.