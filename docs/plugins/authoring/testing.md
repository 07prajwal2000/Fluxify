---
title: Testing a Plugin
description: Unit-test a plugin block with runBlock, an integration with runIntegration and a trigger with runTrigger from @fluxify/sdk/testing, fake what they talk to, and see what the harness cannot check.
---

# Testing

`@fluxify/sdk/testing` runs one block, integration or trigger the way a Fluxify worker would, with no server, database or network. It uses the same rules as the real runtime for defaults, required params, errors, output handles and permissions, so a test that passes here behaves the same there.

```ts
import { expect, it } from "bun:test";
import { runBlock } from "@fluxify/sdk/testing";
import post from "./post";

it("posts to the channel", async () => {
	const r = await runBlock(post, {
		params: { channel: "#general" },
		input: { text: "hi" },
		ctx: { http: { post: async () => ({ data: { ok: true }, status: 200, headers: {} }) } as any },
	});
	expect(r.error).toBeUndefined();
	expect(r.handle).toBe("success");
});
```

Run the tests with `bun test`.

## runBlock

`runBlock(block, options)` resolves with what the block did. It rejects only for what the compiler would reject (an `invoke` mode the block does not allow, or a stub for a handle the block does not have). A block that throws resolves with `error` set.

### Options

| Option | Meaning |
| :--- | :--- |
| `params` | The params as a canvas would store them. Required ones must be present, and TypeScript says so. `js:` strings are evaluated |
| `input` | The previous block's output. Default `undefined` |
| `invoke` | How the canvas calls the block. Default `sync`. `queued` passes `input` and params through JSON, like a real queued job |
| `ctx` | The fakes for `ctx` ([below](#faking-ctx)) |
| `handles` | What each body handle's chain does ([below](#stubbing-body-handles)) |
| `keepAlive` | Keep the run open after `run` returns ([below](#late-calls)) |

### Result

| Field | Meaning |
| :--- | :--- |
| `handle` | The output handle the run left by. `undefined` for a terminal block and for a run that failed with no `failure` handle |
| `output` | What the next block would get: `run`'s output, or the error message when the run left by `failure` |
| `error` | What `run` threw, or why the run failed. Also set when it was routed to `failure` |
| `spans` | Every finished `ctx.span`, with `name`, `parent`, `outcome` (`success` or `failure`), `error` and timing |
| `logs` | Every line written with `ctx.vars.logger`, as `{ level, value }` |
| `handleCalls` | Every body handle call: `handle`, `branch`, `input`, and its `result` or `error` |
| `callAfterEnd(...)`, `end()` | For late calls ([below](#late-calls)) |

Params are defaulted and checked first, so a test of a missing required param looks like this:

```ts
const r = await runBlock(post, { params: {} as never });
expect(r.error?.message).toBe("param 'channel' is required");
```

## Faking ctx

Pass the fakes you need in `ctx`. The ones you leave out are the default noted here.

| `ctx` option | Becomes | Default |
| :--- | :--- | :--- |
| `http` | `ctx.httpClient` and `ctx.vars.httpClient` | Every call throws `not stubbed: ctx.http` |
| `db` | What `getDbAdapter(...)` returns | Throws `not stubbed: ctx.db` |
| `config` | The values `ctx.vars.getConfig` reads | Throws `not stubbed: ctx.appconfig` |
| `kv` | What `getKvAdapter(...)` returns | `memoryKv()`, an in-memory store |
| `queue` | What `getProducer(...)` returns | `memoryQueue()`, which accepts and records every message |
| `vars` | Merged into `ctx.vars`: request helpers like `getHeader`, or run variables | Empty request helpers |
| `projectId`, `route`, `apiId` | The matching `ctx` fields | `test-project`, `/test`, `test-api` |
| `pool` | The pooled clients | A fresh `testPool()` for each run |

A fake that is not provided throws on use, so a block that quietly reaches a real service shows up as a failing test instead of a network call. The `not stubbed` message names the field to pass.

The fakes you can build on are exported from `@fluxify/sdk/testing`:

| Helper | What it is |
| :--- | :--- |
| `memoryKv()` | A key-value store in memory. `setex` expires on the real clock. `entries()` shows what is stored |
| `memoryQueue()` | A queue producer that keeps every message in `sent` |
| `recordingLogger()` | A logger that keeps its lines in `logs` |
| `testPool()` | The pooled clients. Share one across several `runBlock` calls to see a client reused, and read `getStats()` or call `close()` |
| `manualTimer()` | A clock you move by hand (`advance(ms)`), for `testPool({ timer })`, to test an idle client closing without waiting |

**Permissions are enforced.** The harness grants exactly what the block declares in `permissions`. A block that reads app config or opens a database without declaring it fails its test the way it would be refused on a worker.

## Stubbing body handles

A block with body handles needs something to run when it calls `executeHandle`. `handles` gives each handle a stub: a function for a single handle, and a list of branches for an `allowMultiple` one. A stub gets the input the block passed and returns the chain's value.

```ts
const r = await runBlock(agent, {
	params: { prompt: "search" },
	handles: {
		tools: [
			{ label: "search", run: async () => toolOutput },
			{ label: "email", id: "email-1", run: () => { throw new Error("down"); } },
		],
	},
});
```

| Handle kind | Stub |
| :--- | :--- |
| Single | `(input) => value`. May be async. A throw is the chain failing |
| `allowMultiple` | `[{ label, id?, run }]`. `id` defaults to `label`. The block sees them in this order |

- A handle with no stub is a handle with nothing wired: a single handle resolves `undefined`, an `allowMultiple` one resolves `[]`.
- A stub that throws is the chain failing, as on a worker: on an `allowMultiple` handle its slot in the results is `{ error }` and the other branches are untouched, and on a single handle the `executeHandle` call rejects.
- `handleCalls` records every call with its input and result, so you can assert on what the block passed in.

## Late calls

A block can hand out a function that calls `executeHandle` after `run` returned, like the Tool block of the example plugin. On a worker that call still works while the route's run continues, and fails once it ends. The harness mirrors both:

| Option or method | Meaning |
| :--- | :--- |
| `keepAlive: true` | The run stays open after `run` returns, like a route whose later blocks are still running. Late calls work |
| `result.end()` | Ends a `keepAlive` run. Calls after this throw |
| `result.callAfterEnd(handle, input?, { branch }?)` | Ends the run, then calls `executeHandle`. It rejects with the error a late call gets on a worker |

Without `keepAlive` the run ends as soon as `run` returns.

```ts
// source: examples/plugins/agent-tools/src/blocks/tool.test.ts
it("hands the agent its name, schema and a way to run the chain", async () => {
	// keepAlive: the agent calls the tool after this run returned, so the run stays open
	const r = await runBlock(tool, {
		params: { name: "search" },
		handles: { execute: (args) => ({ found: args }) },
		keepAlive: true,
	});
	expect(r.error).toBeUndefined();
	// a terminal block: no output handle
	expect(r.handle).toBeUndefined();
	r.end();
});

it("cannot be called once the run is over", async () => {
	const r = await runBlock(tool, {
		params: { name: "search" },
		handles: { execute: () => 1 },
	});
	await expect(r.callAfterEnd("execute")).rejects.toThrow("called after the run ended");
});
```

## Chaining blocks by hand

A real route connects blocks, but a unit test can do the same in a few lines: run one block, and give its result to the next. Here a Tool block is run first, and its output becomes one branch of the Agent block's `tools` handle:

```ts
// source: examples/plugins/agent-tools/src/blocks/agent.test.ts
async function toolBranch(name: string, execute: (args: unknown) => unknown) {
	const r = await runBlock(tool, {
		params: { name },
		handles: { execute },
		keepAlive: true,
	});
	return { label: name, run: () => r.output };
}

it("calls the tools the prompt names and returns what they gave back", async () => {
	const r = await runBlock(agent, {
		params: { prompt: "search the docs, then email Ada" },
		handles: {
			tools: [
				await toolBranch("search", () => "3 hits"),
				await toolBranch("email", () => "sent"),
			],
		},
	});
	expect(r.handle).toBe("success");
});
```

The same idea chains plain blocks: pass `first.output` as `input` to the second `runBlock`, and `first.handle` tells you whether to run the success or the failure path.

## Testing an integration

`runIntegration(integration, options)` runs one `integration(...)` the way a worker runs it: the config is defaulted and checked, `getConfig` answers only the keys its own secret fields name, and each hook opens and closes a client. It needs no Fluxify runtime.

```ts
import { expect, it } from "bun:test";
import { runIntegration } from "@fluxify/sdk/testing";
import smtp from "./smtp";

it("connects and tests with the password from app config", async () => {
	const run = runIntegration(smtp, {
		config: { host: "smtp.example.com", port: 587, username: "ada", password: "SMTP_PASSWORD" },
		appConfig: { SMTP_PASSWORD: "secret" },
	});
	expect(await run.test()).toEqual({ success: true });
});
```

### Options

| Option | Meaning |
| :--- | :--- |
| `config` | The config as `connect` gets it. A secret field holds the App config **key**; `cfg:KEY` is accepted too, as the stored form uses it |
| `appConfig` | The environment's App config values, by key. `getConfig` reads only the keys this integration's secret fields name |
| `logger` | What `ctx.logger` writes to. Default is a recording logger, available as `run.logs` |

An invalid config fails as it would on the integrations page, for example `Invalid configuration: host: param 'host' is required`.

### The run

| Member | What it does |
| :--- | :--- |
| `await run.client()` | Opens the client a block would get. Calling it again in the same run returns the same client |
| `run.test()` | Runs `test` on a fresh client and closes it |
| `run.describe()` | Runs `describe` on a fresh client and closes it |
| `run.inspect(request?)` | Runs `inspect` on a fresh client, with `inspectRequest` checked first |
| `await run.close()` | Closes the client `client()` opened |

A hook the integration does not define throws, naming it: `Test connection is not available for acme/email/smtp integrations`.

### The integrations fake in `runBlock`

A block that calls `ctx.integrations.get(id)` is tested with `ctx.integrations`, a map from the param's value to what `get` returns:

```ts
const r = await runBlock(send, {
	params: { mail: "mail", to: ["ada@example.com"], subject: "Hi", text: "Hello" },
	ctx: {
		integrations: {
			mail: { kind: "acme/email", client: { sendEmail: async () => ({ messageId: "1" }) } },
		},
	},
});
```

| Fake | What it is |
| :--- | :--- |
| `{ kind, client }` | A prebuilt client. `kind` is the integration's `group` or `group/variant` (`kv`, `kv/Redis`, `acme/email`) |
| `{ integration, config, appConfig? }` | A real `integration(...)`. The harness connects it, reads the secret keys from `appConfig`, and pools it by its `poolKey` |

The fake is checked against the block's `permissions.integrations`, the same way a worker checks the selected integration. A kind the block was not granted fails with `was not granted … integrations`; an id that is not in the map fails with `integration '<id>' does not exist …`.

Use the real integration when the test is about `connect` or the client's behaviour, and a prebuilt client when it is about what the block sends.

## Testing a trigger

`runTrigger(trigger, options)` runs one `trigger({...})` the way Fluxify would: the params are defaulted and checked, the integrations are granted from `permissions`, and `start` gets a `ctx` whose `emit` **records each call** for the test to settle.

```ts
// source: examples/plugins/integrations/src/triggers/orders.test.ts
// ...
const run = await runTrigger(orders, {
	params: { database: "db", table: "jobs", everySeconds: 60, batchSize: 2 },
	integrations: {
		db: { kind: "database/PostgreSQL", client: {}, raw: fakePostgres(rows, updated) },
	},
});
try {
	const call = await run.nextEmit();
	expect(call.events).toEqual(rows);
	// the claim is still open while the workflow runs
	expect(updated).toEqual([]);
	call.resolve();
	await until(() => updated, (ids) => ids.length === 2);
	expect(updated).toEqual([1, 2]);
} finally {
	await run.stop();
}
```

### Options

| Option | Meaning |
| :--- | :--- |
| `params` | The params as the wizard stores them. Required ones must be present, and TypeScript says so |
| `integrations` | What `ctx.integrations.get(id)` and `connection(id)` return, by id, as in `runBlock` ([below](#the-integrations-fake)) |
| `appConfig` | The environment's App config values, by key, for `ctx.getConfig` |
| `logger` | What `ctx.logger` writes to. Default is a recording logger, available as `run.logs` |
| `pool` | Pooled clients. Share one `testPool()` to see reuse. Default: fresh per run |
| `timeoutMs` | How long `start` may take to resolve and how long the stop function may take to return. Default 5000 ms |

A `start` that throws or hangs rejects `runTrigger`. A `start` that resolves to something other than a function also rejects.

### The run

| Member | What it does |
| :--- | :--- |
| `run.emits` | Every `emit` call so far, in order: `{ events, connection, settled, resolve(), reject(error?) }` |
| `run.nextEmit(timeoutMs?)` | The next call not yet handed out. Rejects after the timeout, 5000 ms by default |
| `run.logs` | Every `ctx.logger` line |
| `run.signal` | The `AbortSignal` the trigger got |
| `run.retry` | The definition's `retry` flag |
| `run.failure` | What the trigger passed to `ctx.fail`, if it did |
| `run.failed(timeoutMs?)` | Waits for the next `ctx.fail` and resolves with the error |
| `await run.stop()` | Aborts `ctx.signal`, then awaits the function `start` returned |

An `emit` stays pending until the test settles it, which stands in for the workflow run:

| Call | What the trigger sees |
| :--- | :--- |
| `call.resolve()` | The run succeeded: `emit` resolves |
| `call.reject(error?)` | The run failed: `emit` rejects with `error` |

- Settling the same call twice throws.
- `emit` after `stop()` rejects without being recorded.
- `ctx.fail` stops the instance once, whether `stop()` or `ctx.fail` came first; `run.failed()` waits for that stop to finish.
- The harness does **not** simulate attempts. With `retry: true`, one call is still one `emit` to settle; rejecting it stands for the last attempt failing.

### The integrations fake

`runTrigger` takes the same fakes as `runBlock`:

| Fake | What it is |
| :--- | :--- |
| `{ kind, client, raw? }` | A prebuilt client. `kind` names the variant (`database/PostgreSQL`, `kv/Redis`), and `raw` is what `connection(id).raw` hands out |
| `{ integration, config, appConfig? }` | A real `integration(...)`, connected and pooled the way a worker does it |

A trigger that uses `connection(id).raw` is tested by passing the client it expects under the matching `kind`. That is how the PostgreSQL poller is tested without a database; the same suite also runs one case against a real PostgreSQL container, because a fake cannot prove `FOR UPDATE SKIP LOCKED` holds the rows.

The start of a trigger is also the only thing a harness can test this way: `emit` does not run a workflow, and the group placement, restarts and turn-off count belong to the runtime. Cover those with a route or workflow in a development environment.

## What the harness cannot mirror

These are real differences. Cover them with a route in a development environment before you rely on them.

| Difference | What to do |
| :--- | :--- |
| **`schema` params.** Fluxify compiles the user's schema definition when the route loads. The harness does not | Pass the compiled value yourself, `{ zod, schema }`, with a zod schema of your own and the definition |
| **`js:` values.** The harness evaluates them with `input` in scope. A worker also has the run's variables (`vars`, app config) in scope | Test expressions that use only `input`, or pass the values in as plain strings |
| **`async` and `queued`.** The harness runs the block and waits for it. It does not fire and forget, or put anything on a queue. `queued` only sends `input` and params through JSON | Check that your block works with JSON-only values. Real queueing needs a route |
| **Body handle chains.** A stub stands in for the blocks the user wired. Nothing checks that those blocks exist or give back what your stub does | Keep stubs honest, and test one real chain in a route |
| **Canvas rules.** Compile-time checks, like a Response block inside a body chain, only run when a route is compiled | Try a route |
| **Traces.** `spans` lists your `ctx.span` calls and their parents. It is not the trace the portal draws | Look at a real run's trace |
| **Pooled clients.** The harness uses real `ctx.pool` rules with its own pool, so a client is not shared with anything else | Share one `testPool()` if a test needs to see reuse |

Add the build to your routine as well. `bun run build` catches what a unit test does not: a block named differently from its path, an icon that is too large, and a docs section the Docs tab cannot show.
