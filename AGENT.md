# Coding Agent Persistent Instructions & Fixes

**IMPORTANT:** This file is loaded automatically on every new conversation.
If you encounter a repeatable issue or bug that might arise in the future, you must log the issue and its solution into this file. **However, always ask the user at the end of the conversation if they want you to log it or not before doing so.**

## Runtime & Package Management
**CRITICAL:** Always use `bun` — `bun run`, `bun install`, `bun test`, and `bun` to execute JS/TS files. Never `npm`, `yarn`, or `pnpm`.

## Frontend Location — `apps/portal` ONLY
**CRITICAL:** The frontend is `apps/portal`.
- Portal specifics worth knowing before searching: shared UI lives in
  `packages/components` (HeroUI, e.g. `ConditionsBuilder`, `JsTextField`),
  block settings panels in `apps/portal/src/components/canvas/panel/blocks/`,
  and database introspection is already available via `useDbMetadata`
  (`tableNames` / `getColumnsForTable` / `allColumns`). Check these before
  building a new component — the equivalent usually already exists.
- **Test critical components when you add or change them** (keyboard flows, canvas editing, anything a user can't work around) with React Testing Library on happy-dom, turned on in that test file only. Copy `canvas/BlockPickerSidebar.test.tsx`.

## Git & GitHub Workflow Rules
- **Two remotes, and they are not interchangeable.** Issues, discussions and PRs always target **`Fluxify-rest/Fluxify`** (`--repo Fluxify-rest/Fluxify`). Branches are only ever pushed to the user's fork, `origin` (`git push origin <branch>`). A PR from the fork needs `--head <user>:<branch>`.
- Use the `gh` CLI for everything GitHub — PRs, issues, CI status, merges.
- Ask at the start of a conversation whether to branch or work on `main`.
- **Testing before commit:** test only the folders that changed. The pre-commit hook formats and lints the staged files (Biome, auto-fixed and re-staged), then runs typecheck, FTA analysis and unit tests — **never `--no-verify`**; if it fails, fix the cause (see the FTA section below). Integration and e2e tests (`*.test.ts`, `testing/e2e`) run only in CI, on every PR and push.
- **Format before you commit:** run `bun run lint --write` (Biome: formatting, import order, lint fixes). The hook does the same on staged files, but it is skipped in the GitHub web editor and by `--no-verify`, so CI runs `bun run lint` as the real gate. Biome is the only formatter — never hand-format or add Prettier/ESLint. Rules that bite: `noSecrets` (a fake credential in a non-test file fails the build — put fixtures in `*.spec.ts`/`tests/`), `noSwitchDeclarations`, `noAssignInExpressions`.
- **Secrets:** never commit a real key, not even as a fallback (`process.env.X || "sk-…"`). CI's `secret-scan` job (Gitleaks, `.gitleaks.toml`) checks every commit a PR adds and fails the build; Biome's `noSecrets` catches the same in source. Placeholders belong in `env.example`, docs or tests, which the scan allows.
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
**Golden rule:** A chat request's **last message must be `user` or `tool`** (or an `assistant` message explicitly marked as a prefix). Mistral (and some others) hard-reject anything else with `400 invalid_request_message_order`. Never send a message array whose final element is an assistant or system message, and never re-send a model's final reply back to it. Retry corrections must be a user turn.

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
**Cause:** The conflict was resolved in GitHub's web editor. That path runs **no** local hooks, so the pre-commit chain (Biome → typecheck → FTA analyze → selective tests) never executed. The resolution kept both sides' *bodies* — one PR's wrapper, the other's new logic — but dropped an identifier from the destructuring pattern the second PR had added. Nothing on the server catches a free identifier.
**Fix & Best Practices:**
1. **Never resolve a conflict in the GitHub web editor when both sides touched the same function.** Pull the branch, resolve locally, let the pre-commit hook run, then push.
2. After any merge you resolved by hand, run `bun run --cwd apps/<app> typecheck` (`tsgo --noEmit`) on `main` before assuming it is green. A failing typecheck job may be hiding a runtime break, not a style nit.
3. When two PRs edit one function, expect the conflict to land on the *signature*: verify every parameter each side added still exists in the merged destructuring/argument list.

### Drizzle `sql` Template — Interpolation Is Parameterized, `sql.raw()` Is Not
**Issue:** Reviewing whether user/LLM-supplied search terms in `api/v1/find-resource/search.ts` could be injected.
**Cause/behaviour (verified in `node_modules`, not assumed):** In the `sql` tagged template, literal pieces become `StringChunk`s and every **interpolated value** falls through to `escapeParam(idx, chunk)` → a `$1`-style bound parameter. A `Column` interpolates as an escaped identifier. `sql.raw()` is the **only** path that concatenates text into the query.
**Rules:**
1. `sql\`${column} = ${userValue}\`` is safe — never hand-quote or hand-escape the value, that only creates a double-escaping bug.
2. Treat any `sql.raw()` on a request-derived string as an injection finding.
3. Two things parameterization does **not** cover: values that are *syntax* for another parser (a `to_tsquery` string is bound safely but can still be a malformed tsquery → a runtime error), and `ilike(col, \`%${k}%\`)`, where user `%`/`_` act as LIKE wildcards. Bound ≠ harmless — bound means "cannot escape the value slot".
4. Postgres also errors outright on a type mismatch against a typed id column (`uuid = 'auth'`, `serial = 'auth'`). Where the caller swallows errors into `[]`, one ordinary keyword blanks the entire search — an availability bug, so guard id comparisons with a shape check before they reach the query.

### Bun `sql` Stores a JSON String as a jsonb String, Not an Object
**Issue:** Postgres JSON paths (`profile ->> 'city'`) read `NULL` on every row, even though the column looked filled in.
**Cause:** With Bun's `sql` tag, `${JSON.stringify(obj)}::jsonb` binds the value as a JSON **string scalar** (`"{\"city\":…}"`), not an object. `->>` on a string returns nothing.
**Fix:** Cast through text: `${JSON.stringify(obj)}::text::jsonb`. Postgres then parses the text into a real object. Found seeding `testing/e2e/src/seed.ts`.

### elkjs Cannot Run Under Bun — Layout Lives in `packages/blocks/layout.ts`
**Issue:** `TypeError: undefined is not a constructor (evaluating 'new _Worker(url)')` from any server-side code that constructs `new ELK()`. Tests pass under Node and fail under Bun.
**Cause:** elkjs only lays out inside a Web Worker. Its in-process fallback (`elkjs/lib/elk-worker.min.js`) ends in `module.exports = {default: j, Worker: j}`, and Bun's ESM/CJS interop resolves that to an **empty namespace** — so the constructor is `undefined`. `createRequire`, dynamic `import()`, and passing an explicit `workerFactory` are all dead ends; the module genuinely has nothing to hand back.
**Fix & Best Practices:**
1. **Do not add elkjs (or any worker-dependent layout lib) back.** The layered left-to-right layout in `packages/blocks/layout.ts` is dependency-free, runs identically under Bun and in the browser, and is the single implementation shared by the editor's Format button and the AI agent's canvas edits.
2. Import it from the **subpath** `@fluxify/blocks/layout`, never the root barrel — the barrel drags `jsonwebtoken` and the adapters into the browser bundle (see the package-bleed section above).
3. `layoutGraph(nodes, edges, { changedIds })` returns positions **only** for blocks that actually move, anchored on the leftmost unchanged block, so an AI edit nudges the graph instead of teleporting it to the origin.
4. A green local lint does not prove a dependency was fully removed — `node_modules` still holds it. After dropping a dependency, grep the source for the import (`grep -rn "elkjs" apps packages`), because CI installs clean and will fail on what your local tree still resolves.

### MongoDB Standalone — the Driver Rewrites the "No Transactions" Error
**Issue:** code meant to spot "this server can't run transactions" (a standalone mongod) never matched, so the fallback and the clear error message never ran.
**Cause:** the server refuses with `IllegalOperation` (code 20), "Transaction numbers are only allowed on a replica set member or mongos". But with retryable writes on (the driver's default), the driver (`execute_operation.js`) rethrows it as a **new** `MongoServerError`, "This MongoDB deployment does not support retryable writes…", with **no `code`**, and puts the server's error on `originalError`. A check on `code === 20` plus the server's text only ever sees the rewritten error.
**Fix:** `isTransactionUnsupported` (`packages/adapters/db/transactionErrors.ts`) unwraps `originalError` before matching. Reuse it; don't match the message text anywhere else.
**Test it against a real standalone server** (`packages/blocks/mongoStandalone.test.ts`). Every other Mongo test runs a replica set, and a mock built from the server's error text passes while the real driver fails.

### Touching a Real Integration Means Adding Real Integration Tests
**Rule:** whenever you add or change code that talks to a real external service — a database, a KV store, a queue, an object store — the change is not finished until a `*.test.ts` exercises it against that service in a container. A mock-based `*.spec.ts` is necessary but never sufficient.

**Why this is not optional.** A mock proves what your code *sends*; only the real service proves what happens when it *arrives*. Every one of these is invisible to a mock and has shipped as a bug somewhere:
- A TTL that never actually expires the key (a wrong unit, or `set` where `setex` was meant).
- A value that does not survive the round trip — the store returns text, so numbers, booleans, dates and `null` all come back as strings.
- A missing key that reads as `null` on one provider and `""` or the string `"null"` on another.
- A client whose methods are **callback-based, not promise-based**, so `await` silently yields the client's return value instead of the result (the Memcached client does exactly this; the Redis one does not).
- A connection that is opened per request instead of reused, which no assertion about a mock can detect.
- A provider that rejects a field the mock happily accepted.

**What to write.**
1. Mirror the existing container tests: `beforeAll` removes a stale container by name, `pullImage`, `startContainerWithRandomPort`, then **poll for readiness** — a container that accepts TCP is not a service that accepts queries (MySQL needs ~90 × 500 ms). `afterAll` must remove the container even when the test failed.
2. Use the shared helpers in `packages/adapters/containerTestHelpers.ts` (re-exported as `db/testHelpers.ts`), never a hand-rolled Docker call.
3. Give every test its own randomly-suffixed table and key (`faker.string.alphanumeric(8)`) so tests sharing a container cannot collide.
4. **Test the feature the way a user wires it**, not just the adapter method: compile a real graph and run it, so the emitted code, the factories and the service are all in the assertion. Adapter-only coverage misses everything the compiler does.
5. Cover the edge cases the real service owns: expiry, absence, invalidation, malformed stored data, key isolation, and client reuse across requests.

**Where it goes.** Next to the code it tests, in a package that declares the deps. A container test needs `dockerode` and `@faker-js/faker` in that package's `devDependencies` — they are hoisted to the root `node_modules` so an undeclared import resolves locally and then fails in CI, which installs clean. Graph-level examples: `packages/blocks/kvMysqlCache.test.ts` (a read-through cache over real Redis + MySQL).

**Remember `*.test.ts` only runs in CI**, so it will not slow the pre-commit hook — but it also will not catch your mistake before you push. Run the file directly while developing: `bun test packages/blocks/kvMysqlCache.test.ts`.

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

### Every Docs Page Needs `title` and `description` Frontmatter (It Feeds `llms.txt`)
**Why:** the docs build publishes `llms.txt`, an index AI agents read to find pages (`vitepress-plugin-llms` in `docs/.vitepress/config.ts`). Each entry is the page's `title` and `description`. A page without them is warned about on build (`[docs] <page> has no title ...`) and gets a weak default: its first `# ` heading and the first 100 characters of its text.
**Rules:**
1. Start every new page with `title:` and a one-sentence `description:` that says what the page is for. Don't leave it to the default.
2. Treat a `[docs] ... has no ...` warning in `bun run docs:build` as something to fix, not noise.
3. Add a new section's sidebar key to `LLMS_SECTIONS` in `config.ts`, or its pages land under "Other" in `llms.txt`.
4. Blog posts (`blog/**`) and the home page are left out of `llms.txt` on purpose, so they need no description.
5. Changing the defaults? Run `bun run test:docs`. Bun's test discovery skips `.vitepress`, so CI does not run that spec.

### Deployment Changes Must Update the Deployment Docs in the Same PR
**Why:** coding agents deploy Fluxify by reading `docs/deployments/*` through `llms.txt` (`docs/deployments/coding-agent.md`). A stale page makes them deploy it wrong. `production.md` once described worker services that the compose file no longer had.
**Rule:** when a source file below changes something a user sets or runs into (a new, renamed or required env var, a default, a port, an image, a service, a limit, a startup behavior), update the matching docs in the same PR:

| Source change | Update |
| :--- | :--- |
| `apps/server/src/lib/env.ts`, `packages/common/env.ts` | The `env.example` files, and the settings table in `coding-agent.md#checklist`. Also `kit.md` or `production.md`, whichever the setting belongs to. |
| `env.example`, `docker/kit/*` (compose, Dockerfile, Caddyfile, `entrypoint.sh`) | `kit.md`, and the Kit prompt and checklist in `coding-agent.md` |
| `docker/production/*`, `docker/admin/*`, `docker/orchestrator/*`, `docker/worker-compiled/*` | `production.md`, and the Admin + Workers prompt and checklist in `coding-agent.md` |
| `deploy/helm/fluxify/**` (values, templates, CRDs) | `kubernetes/helm-values.md`, `kubernetes/install.md`, and the Helm prompt in `coding-agent.md` |
| `apps/server/src/modules/orchestrator/**`, `seedDefaultClaim` in `apps/server/src/db/seed.ts` | `production.md` (workers and claims), `kubernetes/index.md` |
| `nodeEntitlement` and the edition rules in `apps/server/src/lib/edition.ts` | `editions.md#workers`, and the workers checklist in `coding-agent.md` |
| Health endpoints, the `Route not found` response, NATS or JetStream requirements | The "How to verify" and "Troubleshooting" sections of `coding-agent.md` |

Before you open the PR, grep `docs/deployments` for the old name or value.

### Block Pages (`docs/blocks/*.md`) Are Also Rendered in the Portal Docs Panel
**Issue:** Each block's **Docs** tab inlines its `docs/blocks/<page>.md` (`apps/portal/.../panel/docs/blockDocs.ts` + `MarkdownViewer.tsx`). VitePress-only syntax that looks fine on the docs site breaks there, and a bad `description:` breaks the whole docs build.
**Rules:**
1. **Template.** Every block page: intro sentence, `## When to use it`, `## Inputs` (table with Required and Default), `## Outputs` (handles table), `## Example`, `## How it behaves`, `## Related blocks`. Read the block source for fields, defaults and handles; never guess.
2. **Keep page file names.** `BLOCK_DOC_PAGES` maps each block type to a page, and `blockDocs.spec.ts` checks they exist. New sub-pages are fine; renames are not. A new block type needs a page before it typechecks.
3. **No in-page `[text](#anchor)` links.** The panel opens every link in a new tab, so they go nowhere. Link as `/blocks/<page>#heading`; relative `./x.md` links are rewritten to `docs.fluxify.rest` automatically.
4. **No `{#custom-id}` on headings.** The panel prints it as text. VitePress generates the same anchor from the heading text.
5. **Only `::: info`, `::: tip`, `::: warning`, `::: danger`, tables, lists, code fences.** No `code-group`, `details`, HTML or images.
6. **Frontmatter values must not contain `: `** (colon + space) unless quoted, or YAML fails and the docs build stops.
7. **Keep pages short.** The panel is narrow. Move long reference material to its own page (`db-conditions`, `db-joins`, `db-paging-sorting`, `js-runner-examples`).
8. **Check:** `bun run docs:build` (temporarily set `ignoreDeadLinks: false` to see dead links, then restore it) and `bun test` in `apps/portal` for `panel/docs`.

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