# agent-tools

An example Fluxify plugin: an **Agent** block that calls the **Tool** blocks wired to it, each tool running a chain of the user's own blocks.

The model is a script (`src/model.ts`), not an LLM, so the same prompt always makes the same calls. That keeps the tests and the end-to-end run stable. Replace `fakeModel` with a call to a provider to make it real.

| File | What it shows |
| :--- | :--- |
| `src/index.ts` | `plugin({ name, url })` |
| `src/blocks/agent.ts` | A body handle with `allowMultiple`, `executeHandle` for every branch in parallel, `ctx.span`, a `[success, failure]` output |
| `src/blocks/tool.ts` | A terminal block whose output holds a function (`invoke: ["sync"]`) and calls `executeHandle` after `run` returned |
| `src/blocks/*.test.ts` | `runBlock` with stubbed body handles, `keepAlive` and chaining blocks by hand |
| `tests/docsInSync.test.ts` | Fails when a snippet quoted in `docs/plugins/authoring` drifts from these files |

```sh
bun test
bun run build   # writes fluxify-examples-agent-tools-1.0.0.tgz
```

`testing/e2e/tests/pluginAgent.test.ts` uploads that tarball to a real stack, approves it, and calls a route that uses both blocks.

The guide that explains all of this is in [`docs/plugins/authoring`](../../../docs/plugins/authoring/getting-started.md).
