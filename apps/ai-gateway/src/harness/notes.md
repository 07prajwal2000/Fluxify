# Harness Markdown Special Syntax

The harness embeds special tokens inside the markdown it returns (planner plan +
summarizer summary). The frontend parses these tokens and renders interactive UI
(chips / buttons) inline, replacing the raw token. This doc is the single source
of truth for that contract.

Format rules for ALL summarizer tokens:
- Every attribute **value** is wrapped in double quotes: `type="add"`.
- Every attribute **name** is `snake_case`, no spaces: `sub_artifact_id`, `parent_type`, `artifact_id`.
- Attributes are never added, dropped, renamed, or reordered.

Design rule: tokens that open a referenced record (`@route`, `@canvasChanges`)
are placed at the **end of a line** so the chip never breaks a sentence.
Creation chips (`@create*`) and the planner's `@resource(...)` are inline-friendly.

---

## 1. Summarizer syntax (agent: `summarizer`)

Emitted in the final run summary. Each referenced token points at a persisted
row so the UI can open the actual implementation.

### `@route(type="...", sub_artifact_id="...")`
References a route change stored as a sub-artifact.
- `type`: `"add"` | `"delete"` | `"changes"`
- `sub_artifact_id`: `agent_harness_sub_artifacts.id` holding the route output
- Rendered as a chip; a reference table can be built from all `@route` tokens.

### `@canvasChanges(parent_type="...", parent="...", artifact_id="...")`
References canvas (block graph) changes stored as a sub-artifact.
- `parent_type`: `"artifact"` | `"route"` | `"custom_block"`
  - `"artifact"` → the parent route is **new** (created this run); `parent` is
    the **sub-artifact id** of that new route.
  - `"route"` / `"custom_block"` → the parent already exists in the DB; `parent`
    is the actual DB record id of that route / custom block.
- `parent`: sub-artifact id (when `"artifact"`) or DB record id (otherwise)
- `artifact_id`: the sub-artifact id storing the canvas-changes payload

### Creation chips (no backing record — UI hint only)
Embedded inline when the user must create something for the run to work:
- `@createIntegration(label="...")`
- `@createAppConfig(label="...")`
- `@createRoute(label="...")`
- `@createCustomBlock(label="...")`

`label` is a short human-friendly string. These render as chips so the summary
English never drifts / reflows badly.

### Hints
Required-action hints are written as markdown blockquotes (`> ...`), concise.

---

## 2. Planner syntax (agent: `planner`)

### `@resource(type, identifier)`
Used in the plan markdown to reference an **existing** resource found via the
`find_resource` tool. The frontend renders it as an interactive resource chip.
- `type`: `route` | `app_config` | `integration` | `custom_block`
- `identifier`: the EXACT unique id (e.g. UUID) fetched from the DB — never
  guessed, never used for not-yet-created resources.
- Example: `Update the @resource(route, 550e8400-e29b-41d4-a716-446655440000) route`.

---

## Persistence model (summarizer)

Order matters: the parent artifact is created first so sub-artifacts can FK to it.

1. `agent_harness_artifacts` — one grouping row per run linking it to its
   sub-artifacts (no data columns; no jsonb blob).
2. `agent_harness_sub_artifacts` — one row per sub-agent output
   (`kind` = `route` | `canvas`, `action` = `add` | `delete` | `changes`,
   `payload` = the actual node/task output). The summary's tokens reference
   these rows by `id`.
3. The summary markdown itself is stored on the **run** (`agent_harness_runs.
   ai_response`) — it is the final result of the harness pass, not artifact data.
