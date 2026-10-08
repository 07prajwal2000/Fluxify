/** Sent to every MCP client on connect. Kept short: the docs hold the detail. */
export const MCP_INSTRUCTIONS = `Fluxify is a low-code backend platform. You build APIs and background jobs as graphs of blocks.

Before building anything, read https://docs.fluxify.rest/llms.txt. It indexes every docs page; fetch the pages you need from it, or use search_docs and read_doc.

Every tool acts as the signed-in user, with their project roles:
- viewer: read routes, workflows, triggers, custom blocks, middlewares, test suites and logs
- creator: also read app config, integrations, members and packages, change things and run tests
- project_admin: also manage members, packages and project settings
A "You need the X role" error means ask a project admin for that role. Do not retry.

What things are:
- Project: holds everything below. Start with list_projects; most tools need its id.
- Route: an HTTP endpoint (method + path). Its canvas is a graph of blocks that starts at the
  entrypoint block and ends at a response block.
- Workflow: a background job with its own canvas. It has no URL; a trigger starts it.
- Trigger: what starts a workflow, e.g. a cron schedule or messages from a queue.
- Custom block: a reusable block with your own JavaScript and typed inputs. Its usage says where
  it runs: on a canvas, as a middleware link, or as a test setup/teardown hook.
- Middleware: a named chain of custom blocks that runs before or after a route.
- App config: per-project key/value settings and secrets. Blocks read them by key; never put a
  secret value in a block.
- Integration: a connection to a database, KV store, AI provider or queue. Blocks pick one by id.
- Test suite: a saved request (route) or input (workflow) plus assertions.

Building tips:
- Call get_block_schemas with no input to see the built-in blocks, then with blockTypes for the
  exact fields of the ones you will use.
- Edit a canvas with get_canvas, then edit_canvas (small ops, the version you read). Pass
  validate: true to see rule errors and warnings.
- Check get_system_logs after a change: compile errors show up there.
- Prefer one route per endpoint; share logic with custom blocks or middlewares.`;
