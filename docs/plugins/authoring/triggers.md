---
title: Plugin Triggers
description: Every field of trigger() for plugin authors, what ctx gives a trigger, how emit runs a workflow, and how to design an at-least-once trigger that is safe to run on several workers.
---

# Triggers

A trigger waits for a signal from anywhere — a poll of a database, a message on a broker, a call to a web API — and hands what it found to Fluxify, which runs the workflow the trigger is attached to. Write one in `src/triggers` as a file that default-exports `trigger({...})`:

```ts
import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";

export default trigger({
	name: "acme/shop/orders/new",
	label: "New orders",
	icon: "./icons/orders.svg",
	permissions: { integrations: ["database"] },
	params: {
		database: param.integration({ kind: "database", variants: ["PostgreSQL"], required: true }),
		table: param.string({ label: "Table", required: true, default: "orders" }),
	},
	async start(ctx) {
		const db = await ctx.integrations.connection(ctx.params.database);
		const loop = (async () => {
			while (!ctx.signal.aborted) {
				const rows = await readNewOrders(db, ctx.params.table);
				if (rows.length) await ctx.emit(rows);
				await pause(ctx.signal, 5_000);
			}
		})().catch((error) => ctx.fail(error));
		return async () => {
			await loop;
		};
	},
});
```

`trigger()` checks the definition when the file loads and throws an error that names the trigger, so a mistake shows up in `bun test` and in the build.

::: info No webhooks
A trigger cannot receive an HTTP request. Routes already own the project's URLs. A route that needs to start a workflow uses the [Send Message](/blocks/send-message) or [Trigger Workflow](/blocks/trigger-workflow) block.
:::

## Fields

| Field | Required | Default | What it is |
| :--- | :---: | :--- | :--- |
| [`name`](#name) | Yes | | The trigger's kind: `scope/name/folder/trigger` |
| [`label`](#label) | Yes | | The name shown in the trigger wizard |
| [`description`](#description) | No | | One line under the label |
| [`icon`](#icon) | Yes | | An image inside the plugin |
| [`permissions`](#permissions) | No | None | What `ctx` may reach |
| [`params`](#params) | No | None | The settings the user fills in |
| [`tabs`](#tabs) | No | By first use | The order of the wizard's steps |
| [`retry`](#retry) | No | `false` | Let Fluxify retry a failed run |
| [`start`](#start) | Yes | | Opens the listener or poll loop |

### name

The trigger's kind: the plugin name plus the path of the file under `src/triggers`. It must be lowercase and match the path exactly, as a block's type must. The build stops if they differ.

A project's trigger stores its kind as `plugin:<name>`, in a column that holds 255 characters, so a name may be at most **248 characters**. The build refuses a longer one.

```ts
name: "acme/shop/orders/new", // src/triggers/orders/new.ts in acme/shop
```

Renaming or moving a trigger breaks every trigger the project created from it; add a new kind and remove the old one later instead.

### label

What the user sees on the wizard's Source step and in the trigger list, next to a **Plugin** badge.

```ts
label: "New orders",
```

### description

A short line under the label on the Source step.

```ts
description: "Starts the workflow for each order a poll finds.",
```

### icon

A path to an image inside the plugin: `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`. The build copies an icon from outside `icons/` into `icons/` so it ships, and stops if the image is missing or too large (about 50 KB). The icon is shown on the wizard's Source step and on the trigger list.

```ts
icon: "./icons/orders.svg",
```

### permissions

What `ctx` may reach, beyond what every trigger gets. A creator sees it when approving the plugin, and the approval covers exactly what you ask for.

| Declare | You get | Use |
| :--- | :--- | :--- |
| `integrations: ["database"]` | `ctx.integrations` | The project's integrations of that kind, by id ([below](#the-context)) |
| `appconfig: true` | `ctx.getConfig` | Any App config key. Without it, `getConfig` reads only the keys your `param.secret()` fields name |

A `param.integration` needs its kind in `permissions.integrations`, and a `param.appconfig` needs `permissions.appconfig: true`. The build refuses a trigger with the param but no permission.

```ts
permissions: { integrations: ["database"], appconfig: true },
```

### params

The settings the user fills in, typed from the declaration so `params` in `start` has the right types. A trigger takes the same `param.*` builders as a block, with two differences:

- `param.secret()` is allowed. The user picks an App config key, and only the key is stored, as `cfg:<KEY>`.
- `js`, `schema`, `conditions` and `fieldMap` are refused. They describe something evaluated per request, and a trigger has no request.

```ts
params: {
	database: param.integration({ kind: "database", required: true }),
	table: param.string({ label: "Table", required: true }),
	everySeconds: param.number({ label: "Poll every (seconds)", default: 30 }),
},
```

An [`integration` param](./params#integration-and-appconfig) can name the variants it accepts with `variants` ([below](#variants)). `all`, `any` and names starting with `__` are reserved. [Params](./params) lists every type and option.

### tabs

The wizard's steps, in order. A trigger's tabs sit between **Basics** and **Workflow**, and params with no tab land in a **Settings** step before them. Without `tabs`, the steps appear in order of first use, with **Settings** first. A param's `tab` that `tabs` leaves out is added after the listed ones, and the build warns about it.

```ts
tabs: ["Connection", "Polling"],
```

### retry

`retry: true` opts into Fluxify's retry system. When a run fails, Fluxify runs it again as many times as the trigger's **Max attempts** setting says (at most 5), waiting the trigger's **Retry delay** before each one, which doubles after each failure. `emit` rejects only after the last attempt fails. The wizard shows **Max attempts** and **Retry delay** only for a kind that declares `retry: true`.

With `retry` off — the default — one `emit` call is one run, and retrying is your code's job.

```ts
retry: true,
```

There is **never** an automatic commit, acknowledgement or dead-letter. Retrying a run is not the same as settling the source event; that stays with you ([below](#designing-an-idempotent-at-least-once-trigger)).

### start

```ts
async start(ctx) {
	// open the listener, or start the poll loop in the background
	return async () => {
		// close what this call opened; must return
	};
},
```

`start` is called once per running trigger instance. It opens the connection or poll loop and **resolves once it is running** — keep the loop going in the background and do not wait for the first event. A `start` that does not resolve within **30 seconds** is treated as a failure.

It returns that instance's **stop function**. Fluxify aborts `ctx.signal` first, then calls the returned function, and expects it to return within **10 seconds**. One definition can run as several triggers at once, each with its own `ctx`, so the cleanup belongs in the closure — not in a top-level field.

```ts
async start(ctx) {
	const client = new MyClient(ctx.getConfig(ctx.params.token));
	const loop = poll(client, ctx).catch((error) => ctx.fail(error));
	return async () => {
		await loop;
		await client.close();
	};
},
```

Nothing to close is `async () => {}`.

There is no top-level `stop` field. `trigger()` refuses one, because one definition can run as several instances and each one's cleanup belongs to its own `start` call.

## The context

| Member | What it is |
| :--- | :--- |
| `ctx.params` | The settings, defaulted and checked, as a block's are |
| `ctx.integrations` | `get(id)` and `connection(id)` for the integrations the trigger was granted ([below](#integrations)) |
| `ctx.getConfig(key)` | An App config value ([below](#getconfig)) |
| `ctx.logger` | `logInfo`, `logWarn` and `logError`, tagged with the trigger's id and kind |
| `ctx.signal` | An `AbortSignal`, aborted when Fluxify stops the trigger, before your stop function runs |
| [`ctx.emit(events, options?)`](#emit) | Runs the attached workflow with the events |
| [`ctx.fail(error)`](#fail) | Reports a fatal error from your own loop |

### Integrations

`ctx.integrations.get(id)` returns the integration a `param.integration` param picked, and `ctx.integrations.connection(id)` returns the same client plus its variant and the variant's own client. Both work for the built-in groups and for an integration your plugin provides. The kind is checked against the trigger's permissions, and the errors are the ones a block sees — `no integration was selected`, `was not granted … integrations`, an unknown id, a disabled plugin.

A trigger is long-lived, not a request: each id is opened **once per instance**, and the trigger holds that client until it stops. A poll loop calling `get` every round reuses one connection instead of opening one per round. Stopping the trigger releases the clients.

```ts
permissions: { integrations: ["kv"] },
params: { store: param.integration({ kind: "kv", required: true }) },
async start(ctx) {
	const kv = await ctx.integrations.get<"kv">(ctx.params.store);
	// one client for the life of this trigger instance
},
```

Use `connection` when the trigger needs the variant's own client, such as a Redis `XREADGROUP` or a database's raw query interface. [Variant-specific integrations](./integrations#variant-specific-integrations) covers `variants` and narrowing.

### getConfig

`ctx.getConfig(key)` reads an App config value. With `permissions.appconfig` it reads any key; without it, only the keys the trigger's own `param.secret()` fields name. It takes the key or a secret param's stored value, so this works:

```ts
params: { dsn: param.secret({ label: "Connection URL", required: true }) },
async start(ctx) {
	const url = ctx.getConfig(ctx.params.dsn); // ctx.params.dsn is "cfg:DATABASE_URL"
},
```

An error names the missing key, never a value. A secret param whose key has no value in this environment keeps the trigger from starting, the way a missing value stops a queue trigger.

### emit

`ctx.emit(events, options?)` runs the workflow attached to this trigger, **in the same process**, on the worker running the trigger. It takes an **array, one item per event**; each item becomes one entry in the workflow's `trigger.data`, with its `data` as you passed it.

```ts
await ctx.emit([
	{ orderId: "A-1024", total: 42 },
	{ orderId: "A-1025", total: 17 },
]);
```

When exactly one event arrives, `input` is that event's payload. All of them are in `trigger.data`:

```js
trigger.data[0].data.orderId // "A-1024"
trigger.meta.size            // 2
trigger.meta.attempt         // 1, then 2 on a retry
```

`emit`:

- resolves when the run succeeds, and rejects when it fails;
- with `retry: true`, rejects only after the **Max attempts** setting is used up, with the last error;
- runs one workflow run per call, with every event of that call in it;
- allows concurrent calls — two `emit`s in flight are two runs;
- rejects without running when the trigger is stopping, or when the workflow is not loaded on this worker.

An empty array is a run with no events; call it only when you mean that.

### The connection

`emit` takes an optional `connection`, which the workflow sees as `trigger.connection`:

```ts
await ctx.emit(rows, {
	connection: {
		raw: transaction,
		commit: async () => {
			await markDone(rows);
		},
		moveToDLQ: async (error) => {
			await park(rows, error);
		},
		lag: async () => countWaiting(),
	},
});
```

| Member | What it is |
| :--- | :--- |
| `commit()` | Marks this batch processed. Called by a workflow that commits manually |
| `moveToDLQ(error?)` | Parks this batch somewhere else |
| `lag()` | Messages waiting behind this batch, or `null` when unknown |
| `raw` | Whatever you put here: the source's own client, or a transaction handle |

All three functions are required; `raw` is not. This is the same API the built-in queue triggers expose in manual commit mode, and it works because the run is in the same process: `await trigger.connection.commit()` in a JS Runner block calls **your** function.

Nothing calls `commit` for you. A workflow only commits if it is written to.

### fail

`ctx.fail(error)` reports a fatal error from your own background loop — one Fluxify cannot see otherwise. The instance stops (`ctx.signal` aborts, then your stop function runs) and starts again after a backoff. After **5 failures in a row** the trigger is turned off, with the error's message as the reason on the trigger row.

```ts
const loop = (async () => {
	while (!ctx.signal.aborted) {
		// ...
	}
})().catch((error) => ctx.fail(error));
```

::: warning Call `ctx.fail` from the loop's `catch`
An error nobody catches does not crash the worker — the execution process logs it and stays up — but it is only blamed on your trigger when Fluxify can prove which trigger it came from. With two instances of one kind running, it cannot, so the error is only logged and your loop is not restarted. Calling `ctx.fail` from the loop's `catch` is the reliable path.
:::

A run failure is **not** a `ctx.fail`: a failed `emit` means the workflow run failed, and retrying it is what `retry` and your code are for. Reserve `ctx.fail` for the loop itself — a lost connection, a broken decoder, a missing table.

## Designing an idempotent, at-least-once trigger

Delivery is **at least once**. A worker can be killed after the workflow ran but before the source learned about it, and the next poll or delivery runs the same event again. Design for that from the start.

### Commit only after `emit` resolves

`emit` resolves when the run succeeded. Commit, acknowledge or mark the source event done **after** that, never before:

```ts
await ctx.emit(rows);       // the workflow succeeded
await markDone(rows);       // now the source may forget them
```

If the worker dies between the two, the rows are read again and the workflow runs a second time. That is the cost of at-least-once; losing the event entirely is the alternative. A commit before `emit` turns a crash into a lost event.

If your source has its own acknowledgement (an `XACK`, a broker ack), send it in the same place: after `emit` resolves. With `retry` on, that is after the last attempt.

### Every worker in the group runs start

A trigger runs in the execution process of **every worker in its group**, and each instance calls `start`. That is fine for a source you can claim work from, and wrong for one you cannot:

| Source | What to do |
| :--- | :--- |
| Queue or broker | Read as a **consumer group**, so each message goes to one consumer. Kafka consumer groups, NATS durable consumers, RabbitMQ competing consumers and Redis consumer groups all do this |
| Database | Claim the rows in a transaction: `SELECT … FOR UPDATE SKIP LOCKED`, then `emit`, then mark them done, then commit. A second worker skips the locked rows instead of reading them again |
| Web API with no way to claim an item | Give the trigger a group that runs **one replica**. Nothing else stops two workers from both reading the same item |

A database poller must **lock even for a read**. A plain `SELECT` does not, so on a group with several workers every worker fans the same rows out to its own run.

The claim and the commit belong to the **same transaction**, and `emit` happens between them. A worker killed mid-run rolls the transaction back, so the row is free for another worker — and runs again. That is the pattern the [integrations example](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/integrations) uses.

::: info Groups do not coordinate instances
A group decides where the trigger runs, not which instance does the work. Every worker in the group starts its own copy. Use the broker's consumer groups, row locking, or a single-replica group.
:::

### Deduplicate by the source's own id

At-least-once means the same event can arrive twice. Make the workflow safe to repeat:

- Put the source's stable id in each event, so the workflow can recognise it.
- Store the ids you handled — a `processed` table, a unique constraint, an idempotency key on the downstream API — and skip or upsert on a repeat.
- Do not use a timestamp or a per-delivery number as the key. It changes on a redelivery.

Fluxify does not deduplicate for you: only you know what "already handled" means for your source.

### Honour `ctx.signal`

`ctx.signal` aborts when Fluxify stops the trigger: a withdrawn plugin, a disabled plugin, a group move, a version upgrade, a shutdown. Your loop should check it every round, and every wait should wake when it aborts:

```ts
function pause(ctx: TriggerContext, ms: number) {
	if (ctx.signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		let timer: ReturnType<typeof setTimeout>;
		function done() {
			clearTimeout(timer);
			ctx.signal.removeEventListener("abort", done);
			resolve();
		}
		timer = setTimeout(done, ms);
		ctx.signal.addEventListener("abort", done, { once: true });
	});
}
```

Check `ctx.signal.aborted` before waiting, not just inside the listener: stop can arrive while an `emit` is still running, and a listener added to an already-aborted signal never fires.

A stop function that does not return within **10 seconds** is logged and dropped during a shutdown or a withdrawal. During a restart it counts as a failure and the instance is restarted.

### Turn-off, and turning it back on

When the trigger is turned off, the portal shows the reason on the trigger row and on its edit page, as text you wrote or the runtime's summary — for example:

| Reason | Cause |
| :--- | :--- |
| `start failed: <message> (failed 5 times in a row)` | `start` threw five times |
| `start failed: it did not resolve within 30s` | `start` never resolved |
| `start failed: start() must resolve to its stop function` | `start` returned something else |
| `ctx.fail: <message> …` | Your loop reported it |
| `unhandled error: <message> …` | An error traced to this instance |
| `stop timed out after 10s …` | The stop function did not return |

**Turning it back on** is the normal enable switch: Fluxify re-checks the plugin and the params, starts a fresh instance and resets the failure count. A start error is often a wrong table name or a missing App config value, so fix the cause first — otherwise the count runs out again.

An instance that stayed up for **60 seconds** starts the count again, so a trigger that works for a while and then fails once is not five failures into being turned off.

## Limits

| Limit | Value |
| :--- | :--- |
| `start` must resolve within | 30 seconds |
| The returned stop function must return within | 10 seconds |
| Restart wait after a failure | 1 second, doubling each time |
| Failures in a row before the trigger is turned off | 5 |
| Running time that resets the count | 60 seconds |
| Trigger name | 248 characters (so `plugin:<name>` fits 255) |
| Icon size | about 50 KB |
| Max attempts, with `retry` | 1 to 5, default 3 |
| Retry delay, with `retry` | 0 to 300000 ms, default 1000, doubling |

## Scaffolding

```sh
bunx fluxify-cli triggers create orders/new
```

This writes `src/triggers/orders/new.ts`, a test and a placeholder icon. The template is a poll loop that honours `ctx.signal`, emits a batch, and calls `ctx.fail` from its `catch`. The trigger's kind is the plugin name plus the path: `acme/shop/orders/new`.

| Flag | Meaning |
| :--- | :--- |
| `--force` | Not used by this command |

`bun run build` writes the `triggers` list into `fluxify.json`, checks the name, params, icon and entry path, and warns about a tab the params do not use.

## A complete trigger

The [integrations example](https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/integrations) has a database poller that claims rows with `SKIP LOCKED` on PostgreSQL or MySQL, emits them, and marks them done only after the run succeeded:

```ts
// source: examples/plugins/integrations/src/triggers/orders.ts
// ...
params: {
	database: param.integration({
		// ...
		kind: "database",
		variants: ["PostgreSQL", "MySQL"],
		required: true,
	}),
	// ...
	everySeconds: param.number({
		label: "Poll every (seconds)",
		default: 10,
	}),
	// ...
	batchSize: param.number({
		label: "Rows per poll",
		// ...
		default: 50,
	}),
},
async start(ctx) {
	const connection = await ctx.integrations.connection(ctx.params.database);
	const table = ctx.params.table;
	// ...
	const limit = Math.max(BATCH_MIN, Math.min(BATCH_MAX, Math.floor(ctx.params.batchSize)));
	const everyMs = Math.max(1, ctx.params.everySeconds) * 1_000;
	const emit: Emit = (rows) => ctx.emit(rows);
	const poll =
		connection.variant === "PostgreSQL"
			? () => pollPostgres(connection.raw, table, limit, emit)
			: () => pollMysql(connection.raw, table, limit, emit);
	const loop = (async () => {
		while (!ctx.signal.aborted) {
			const handled = await poll().catch((error) => {
				ctx.logger.logError(error);
				return 0;
			});
			if (handled < limit) await pause(ctx.signal, everyMs);
		}
	})().catch((error) => ctx.fail(error));
	return async () => {
		await loop;
	};
},
```

| File | What it shows |
| :--- | :--- |
| `src/triggers/orders.ts` | `variants`, narrowing on `variant`, `FOR UPDATE SKIP LOCKED`, `emit` then commit, and `ctx.fail` in the loop's `catch` |
| `src/triggers/orders.test.ts` | `runTrigger` with a fake connection for each variant, and a real PostgreSQL container |

## Next

- [Params](./params): the settings a user fills in
- [Integrations](./integrations#variant-specific-integrations): narrowing an integration param to the variants you support
- [Testing](./testing#testing-a-trigger): `runTrigger` and the connection fakes
- [Upgrading](/plugins/upgrading): which changes to a trigger block an upgrade
