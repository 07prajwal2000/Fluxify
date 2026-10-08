---
title: Connect an AI Agent
description: Connect Claude, Cursor or another AI agent to Fluxify through its MCP server, sign in with OAuth or an access token, and see every tool and the project role it needs.
---

# Connect an AI Agent

Fluxify has an **MCP server**. MCP is a standard way for AI apps and coding
agents to use outside tools. Once connected, an agent can read your projects,
build routes and workflows, run tests and manage members, all as you.

::: tip For agents
Read [llms.txt](https://docs.fluxify.rest/llms.txt) first. It lists every docs
page, so you can fetch only the ones you need.
:::

## The URL

The MCP server lives on your Fluxify address, at `/_/admin/mcp`:

```
https://your-domain.com/_/admin/mcp
```

On a local install that is `http://localhost:<port>/_/admin/mcp`. Cloud apps
such as claude.ai need a public `https://` address. See
[Connecting AI clients](/deployments/production#mcp).

## Connect with OAuth (recommended)

Add the URL to your client. The first time it connects, your browser opens.
Sign in to Fluxify and approve the app. That is all.

**Claude Code**

```bash
claude mcp add --transport http fluxify https://your-domain.com/_/admin/mcp
```

**Claude Desktop and claude.ai**

Open **Settings → Connectors → Add custom connector** and paste the URL.

**Cursor** (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "fluxify": { "url": "https://your-domain.com/_/admin/mcp" }
  }
}
```

## Connect with an access token

Use a token when the client can't open a browser, such as a script or a CI job.

1. In Fluxify, open **Account → Access tokens** and create one. It starts with `flx_`.
2. Copy it now. It is shown only once.
3. Send it as a Bearer header:

```bash
claude mcp add --transport http fluxify https://your-domain.com/_/admin/mcp \
  --header "Authorization: Bearer flx_your_token"
```

```json
{
  "mcpServers": {
    "fluxify": {
      "url": "https://your-domain.com/_/admin/mcp",
      "headers": { "Authorization": "Bearer flx_your_token" }
    }
  }
}
```

Treat the token like a password. Anyone who has it can act as you.

## What the agent can do

The agent gets **your** access, no more. In each project it can do what your
role there allows:

- **Viewer** reads routes, workflows, triggers, custom blocks, middlewares, test suites and logs.
- **Creator** also reads app config, integrations, members and packages, changes things and runs tests.
- **Project Admin** also manages members, packages and project settings.

If the agent asks for something your role does not allow, it gets an error
like "You need the Creator role in this project." Ask a project admin for the role.

### Every tool

"Real" means the tool does something outside Fluxify's own data: it sends a
request, runs your code or reaches the internet.

| Tool | What it does | Minimum role |
| :--- | :--- | :--- |
| `whoami` | Who the agent is signed in as, and your project roles | Any signed-in user |
| `get_instance_info` | Edition, licence and version | Viewer |
| `get_block_schemas` | The built-in blocks and their fields | Viewer |
| `search_docs` | Search the Fluxify docs; returns the matching sections | Viewer |
| `read_doc` | One docs page's list of sections, or one section's text | Viewer |
| `get_integration_schema` | The fields one integration type needs | Viewer |
| `list_projects` | Your projects | Viewer |
| `get_project` | One project's name and description | Viewer |
| `get_system_logs` | Compile results and other errors | Viewer |
| `list_routes` | A project's routes | Viewer |
| `get_route` | One route's settings and request schemas | Viewer |
| `list_workflows` | A project's workflows | Viewer |
| `get_workflow` | One workflow's settings | Viewer |
| `list_triggers` | A project's triggers | Viewer |
| `get_trigger` | One trigger's settings | Viewer |
| `list_custom_blocks` | A project's custom blocks | Viewer |
| `get_custom_block` | One custom block's inputs and docs | Viewer |
| `list_middlewares` | A project's middlewares | Viewer |
| `get_middleware` | One middleware and its blocks | Viewer |
| `list_test_suites` | The test suites of a route or workflow | Viewer |
| `get_test_suite` | One test suite | Viewer |
| `get_canvas` | The blocks and connections of a canvas | Viewer |
| `list_app_config` | A project's app config keys (no values) | Creator |
| `get_app_config` | One app config entry (secrets stay masked) | Creator |
| `list_integrations` | A project's integrations | Creator |
| `get_integration` | One integration's settings | Creator |
| `list_members` | A project's members and roles | Creator |
| `list_packages` | A project's npm packages | Creator |
| `get_test_runs` | A test suite's recent runs and results, with each case's trace id | Creator |
| `list_recordings` | A route's or workflow's [recorded runs](../concepts/execution-recording.md) | Creator |
| `get_recording` | One recorded run, block by block | Creator |
| `save_route` | Create or change a route | Creator |
| `delete_route` | Delete a route | Creator |
| `save_workflow` | Create or change a workflow | Creator |
| `delete_workflow` | Delete a workflow | Creator |
| `save_trigger` | Create or change a trigger | Creator |
| `delete_trigger` | Delete a trigger | Creator |
| `save_middleware` | Create or change a middleware | Creator |
| `delete_middleware` | Delete a middleware | Creator |
| `save_custom_block` | Create or change a custom block's details | Creator |
| `delete_custom_block` | Delete a custom block | Creator |
| `save_app_config` | Create or change an app config entry | Creator |
| `delete_app_config` | Delete an app config entry | Creator |
| `save_integration` | Create or change an integration | Creator |
| `delete_integration` | Delete an integration | Creator |
| `test_integration_connection` | Check an integration connects (real) | Creator |
| `edit_canvas` | Add, change and connect blocks on a canvas | Creator |
| `call_route` | Send a request to a route (real) | Creator |
| `run_test_suite` | Run a test suite (real) | Creator |
| `add_member` | Add a user to a project | Project Admin |
| `update_member_role` | Change a member's role | Project Admin |
| `remove_member` | Remove a member | Project Admin |
| `install_package` | Install npm packages (real) | Project Admin |
| `remove_package` | Uninstall npm packages | Project Admin |
| `update_project` | Change a project's name, description or hidden flag | Project Admin |

## Safety

::: warning Runs are real
`call_route` and `run_test_suite` run your code for real. If a route writes to
a database, sends an email or calls another API, that happens. Point agents at
a test project when you can.
:::

::: info Debug errors
When a route fails, its callers get a short message such as
`failed to execute native db block`, never the database error or a stack trace.
`call_route` also returns the real error: the block that failed, its message,
the cause behind it (such as the SQL error), and, for an error in your own
code, where in that code it happened. Only a creator calling through the tools
gets it; anyone calling the route's URL, whatever headers they send, still gets
the short message.
:::

- **You approve every app.** An app can't connect until you sign in and say yes
  in your browser.
- **Your client may ask before each change.** Tools that delete or run things
  are marked as such, so most clients ask you first.
- **Revoke access any time.** Open **Account → Connected apps** to remove an app,
  or **Account → Access tokens** to delete a token. It stops working at once.
- **Apps stay signed in for up to 30 days.** A connected app gets a short-lived
  token and renews it by itself. Each renewal hands out a new one and retires the
  old one. If the app goes unused for 30 days, you sign in again. Removing the
  app ends all of this at once.
