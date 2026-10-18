---
title: Custom block reference for agents
description: Fields, inputs, usage kinds, errors and JSON examples for creating a custom block with save_custom_block and writing its code on its canvas.
---

# Custom block reference for agents

A custom block is a reusable block with your own JavaScript and typed inputs. `save_custom_block` sets its details. Its **code lives on its canvas**, which you edit with `edit_canvas`. For background, see [Custom Blocks](/blocks/custom-blocks).

## Tools

| Tool | Role | What it does |
| --- | --- | --- |
| `list_custom_blocks` | viewer | Blocks of a project: id, name, label, description, usage. |
| `get_custom_block` | viewer | One block: id, name, label, description, usage, `inputParams`, `docs`, the version live in production, whether it has uncommitted changes, and everything that uses it (`references`). Not its code. |
| `save_custom_block` | creator | Create (no `customBlockId`) or update (`customBlockId`) the details. |
| `extract_custom_block` | creator | Turn blocks on a canvas into a new custom block. See [Extract blocks into a custom block](#extract-blocks-into-a-custom-block). |
| `delete_custom_block` | creator | Deletes the block and its code. Refused while a route, workflow, block, middleware or test hook uses it. |
| `commit_version`, `promote_version`, `rollback_version` | creator | Version the block with `kind: "custom_block"`. See [Versions](#versions). |
| `get_canvas`, `edit_canvas` | viewer, creator | Read and write the code. `kind` is `"custom_block"`. |

## Create a custom block

Pass `projectId`, `name` and `label`.

```json
{
  "projectId": "<project id>",
  "name": "slack_notify",
  "label": "Slack notify",
  "description": "Posts a message to a Slack webhook",
  "usage": "flow",
  "inputParams": [
    { "type": "text_input", "name": "message", "label": "Message", "description": "Text to post" },
    { "type": "app_config_selector", "name": "webhook_key", "label": "Webhook secret" }
  ]
}
```

The result is `{ "id": "<custom block id>" }`.

A new block has an entrypoint and an error handler on its canvas, and no code yet. See [Write the code](#write-the-code).

## Update a custom block

Pass `customBlockId` and only the fields that change. `name`, `usage` and `projectId` cannot change after create. If you pass them they are ignored.

```json
{ "customBlockId": "<custom block id>", "label": "Slack message", "docs": "# Slack notify\nPosts `message` to the webhook." }
```

`inputParams` replaces the whole list. Send the full list, not one change.

## Fields

| Field | Type | Rule | Default |
| --- | --- | --- | --- |
| `projectId` | string | Create only. | none |
| `name` | string | Lowercase letters, digits and `_` only. Create only. Unique in the project. | none |
| `label` | string | Shown in the block picker. Up to 50 characters. | none |
| `description` | string | Free text. | none |
| `usage` | string | `flow`, `test` or `middleware`. Create only. See [Usage](#usage). | `flow` |
| `inputParams` | list | See [Input parameters](#input-parameters). | none |
| `docs` | string or null | Markdown shown in the block's docs. Up to 100000 characters. | none |
| `icon` | string | `premade-list` or `custom`. | none |
| `iconUrl` | string | With `premade-list`: the icon name, for example `code`, `webhook`, `json` or `brand-slack`. With `custom`: a URL or base64 data, up to 68266 characters. | none |

The stored name is `user_defined.project.<name>`. The database holds at most 50 characters of it, so keep `name` to 29 characters or fewer. Use the stored name from `get_custom_block` when you place the block on a canvas.

## Usage

`usage` says where the block may run. It is fixed at create, because routes, test suites and middlewares depend on it.

| `usage` | Where it runs |
| --- | --- |
| `flow` | On any route, workflow or custom block canvas. |
| `test` | Only as a [test suite](/agents/test-suite) setup, teardown or input loader. Hidden from canvases and never run by live traffic. |
| `middleware` | Only as a link in a [middleware](/agents/middleware). It takes no input parameters: `inputParams` is always saved as an empty list. |

## Input parameters

`inputParams` is a list. Each item has a `type`, a `name` (lowercase letters, digits and `_`), a `label` and an optional `description`.

| `type` | Extra fields | Use it for |
| --- | --- | --- |
| `text_input` | none | A text value. It accepts a `js:` expression, such as `js: return input.id`. |
| `checkbox` | none | On or off. |
| `array_editor` | none | A list of values. |
| `dropdown` | `options`: `[{ "label": "...", "value": "..." }]` | A fixed set of choices. |
| `integration_selector` | `group` (required), `variant` (optional), `tags` (list, default `[]`) | The id of one of the project's [integrations](/agents/integration). |
| `app_config_selector` | none | The **key** of an [app config](/agents/app-config) entry. |

Prefer `app_config_selector` for secrets. The block receives the key, and reads the value with `getConfig(params.webhook_key)`. The secret is never stored in the canvas.

## Write the code

The code is the block's canvas. Read it first to get the revision and the block keys.

```json
{ "target": { "kind": "custom_block", "id": "<custom block id>" } }
```

Then add a `jsrunner` block and wire it between the entrypoint and the end of the chain. Pass the `revision` from `get_canvas`.

```json
{
  "target": { "kind": "custom_block", "id": "<custom block id>" },
  "revision": 0,
  "ops": [
    { "op": "add_block", "ref": "code", "type": "jsrunner",
      "data": { "value": "const url = getConfig(params.webhook_key);\nconst res = await httpClient.post(url, { text: params.message });\nreturn { ok: res.status === 200 };" },
      "connect_from": { "from": "entrypoint_1" } }
  ],
  "validate": true
}
```

Inside the code:

| Name | What it is |
| --- | --- |
| `input` | The output of the block before this custom block on the caller's canvas. |
| `params` | The values the caller filled in, by parameter `name`. |
| `getConfig(key)` | Reads an app config value of the project. |

Whatever the last block outputs is the custom block's result.

## Extract blocks into a custom block

`extract_custom_block` builds a custom block from blocks that already work on a canvas, in one call.

```json
{ "projectId": "p1", "from": { "kind": "sandbox", "id": "<sandbox id>" },
  "keys": ["jsrunner_1", "jsrunner_2"], "name": "shout_text", "label": "Shout text" }
```

| Field | Notes |
| --- | --- |
| `from` | The canvas: `route`, `workflow`, `custom_block` or your own `sandbox`, in the same project. |
| `keys` | Block keys from `get_canvas`. The entrypoint and error handler cannot be extracted. |
| `name`, `label` | Required. `name` uses lowercase letters, digits and `_`. |
| `replace` | Default `false`. When `true`, the selection on the source canvas becomes one instance of the new block. It asks the user first, even in auto mode. |

The new block has the default icon, usage `flow`, no description and no input parameters. The previous block's output is its `input`, and what its last block returns is its output. Edit the details afterwards with `save_custom_block`.

The selection has to be tidy: one entry block, at most one edge into it, and at most one edge out of its single last block. If it is not, the call is refused and the message says what to clean up. Ask the user to tidy the canvas; do not rewire it yourself.

## Use a block on a canvas

Add a block whose `type` is the stored name. Put each parameter value in `data`, by parameter name. A value can be a `js:` expression. See [Dynamic values and `js:` expressions](/agents/expressions).

```json
{ "op": "add_block", "ref": "notify", "type": "user_defined.project.slack_notify",
  "data": { "message": "js: return 'New order ' + input.id", "webhook_key": "SLACK_WEBHOOK", "invoke": "sync" },
  "connect_from": { "from": "<previous block key>" } }
```

`invoke` is optional:

| `invoke` | Behaviour |
| --- | --- |
| `sync` (default) | The flow waits and uses the block's output. A failure fails the flow. |
| `async` | The block starts and the flow carries on. Its output is not available. Lost if the server restarts. |
| `queued` | Saved as a job and run later, possibly on another worker. It survives restarts and may be retried, so make it safe to run twice. Only the params and input are handed over. |

## Versions

A custom block has versions like a route. **Development runs the latest saved state. Production runs the promoted version.** Promoting or rolling back a block changes every production route and workflow that uses it, so its tests gate runs the suites of each of them first. See [Custom blocks and middlewares](/concepts/versioning#custom-blocks-and-middlewares).

- `commit_version` with `kind: "custom_block"` saves its canvas and inputs. `list_versions` and `get_version` read the history.
- `promote_version` and `rollback_version` always ask a person, who writes the reason.
- A route that uses a block with no promoted version cannot be promoted: the failure lists the blocks by `id` and `name`. Promote those first.
- `get_custom_block` shows `references`: each route, workflow, block, middleware or test suite that uses the block, with `inProduction` when its promoted version does.

## Common errors

| Message | Cause and fix |
| --- | --- |
| `Invalid input: name: ...` | `name` has a character outside lowercase letters, digits and `_`. |
| `Invalid input: iconUrl: Invalid premade icon name` | With `icon: "premade-list"`, `iconUrl` must be a premade icon name. |
| `Fluxify API error 409: custom block with name user_defined.project.X already exists in this project` | Pick another `name`. |
| `Fluxify API error 409: This custom block is still used by ...` | On delete: the message names each route, workflow, block, middleware or test suite that uses it, in a working copy or a promoted version. Remove the use there first, or promote a version that no longer has it. Sandboxes never block it. |
| `Fluxify API error 403: Cannot delete a custom block originating from a plugin` | Plugin blocks cannot be deleted. |
| `The selection has 2 entry blocks (...)` or `Connections ... must be one edge ...` | `extract_custom_block` needs a tidy selection. Ask the user to clean up the connections, then try again. |
| `Not found: Custom block not found` | Wrong `customBlockId`. Use `list_custom_blocks`. |
| `No codegen for block type` in `get_system_logs` | A canvas uses the bare name. Use the stored name `user_defined.project.<name>`. |
| `You need the Creator role in this project.` | Ask a project admin. Do not retry. |
