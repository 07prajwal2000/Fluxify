---
title: Setup and Teardown
description: Add test data before a test suite runs and clean it up afterwards, using custom blocks made only for testing.
---

# Setup and Teardown

Many routes need data to exist before you can test them: a user to log in, an order to cancel, a product to look up. **Setup** adds that data before the suite's request. **Teardown** removes it afterwards, so every run starts clean.

Setup and teardown are **custom blocks**, so they can do anything a custom block can: insert rows, call an API, generate fake data with a library, and so on.

## 1. Make a test-only custom block

1. Create a custom block (see [Custom Blocks](/blocks/custom-blocks)), for example `seed_users`.
2. Open its **Settings** and tick **Use only for test suite setup / teardown**.
3. Save.

A test-only block:

- **is hidden from the block picker**, so nobody adds it to a live route by mistake;
- **can't be saved onto a route, workflow or normal custom block**, even through the API or the AI assistant;
- **never runs in live traffic**. It only runs as a suite's setup or teardown.

::: warning Changing the box later
- You can't tick the box while a route, workflow or normal custom block still uses the block. Fluxify lists where it is used; remove it there first.
- You can't untick the box while a test suite uses the block for setup or teardown. Pick another block in those suites first.
:::

## 2. Build what it does

Build the block's canvas like any other custom block. While it runs, it can read a value called `testsuite`:

| Name | What it is |
| --- | --- |
| `testsuite.phase` | `"setup"` when it runs before the request, `"teardown"` when it runs after |
| `testsuite.runId` | A value unique to this suite run. Put it in your test data so suites running at the same time never clash |
| `testsuite.suite` | The suite's `id` and `name` |
| `testsuite.setup` | Teardown only: what the setup block returned |
| `testsuite.outcome` | Teardown only: how the suite ended: `"passed"`, `"failed"`, `"error"` or `"timeout"` |

The editor suggests these names only on the canvas of a test-only block.

**Whatever the block's last step returns is its result.** For setup, that result is handed to the rest of the suite (see [step 4](#_4-use-the-setup-result)).

### Example: seed a user

A `seed_users` block with **Entrypoint → JS Runner → Insert New Record** (into a `users` table), where the JS Runner makes the row:

```js
import { faker } from "@faker-js/faker";

return {
  email: `${testsuite.runId}@test.local`,
  name: faker.person.fullName(),
};
```

**Insert New Record** returns the new row, so the setup's result is the new user.

A `cleanup_users` block for teardown deletes it again, using what setup returned:

```js
// in a JS Runner before a Delete Record(s) block
return { id: testsuite.setup.id };
```

Packages such as `@faker-js/faker` must be added to the project first. See [Imports & Libraries](/scripting/imports).

## 3. Choose them in the suite

Open the suite, choose the **Setup & teardown** tab, and pick:

| Field | What it does |
| --- | --- |
| Setup | The test-only block that runs **before** the request, or None |
| Teardown | The test-only block that runs **after** the checks, or None |
| Time limit | How long each may take, in seconds (default 30, up to 600) |
| Run alone | Run this suite by itself, after the other suites (see [below](#run-alone)) |

Press **Save**. Only test-only blocks of the project are offered.

## 4. Use the setup result

Setup's result is available to the rest of the suite:

- in [hooks](./hooks) and [Custom JS checks](./checks#custom-js-checks) as `t.setup`;
- in the teardown block as `testsuite.setup`.

```js
// Custom JS check: the route returned the user setup created
t.expect(fluxify.response.body.id).toBe(t.setup.id);
```

## What happens when something goes wrong

| Situation | What happens |
| --- | --- |
| Setup fails or runs out of time | The request is **skipped** and the suite is marked **error** ("Setup failed: …"). Teardown **still runs**, so half-added data is cleaned up |
| The route runs out of time | The suite is marked **timeout**. Teardown **still runs**, with the setup result |
| Checks fail | The suite is marked **failed**. Teardown runs as normal |
| Teardown fails or runs out of time | The suite **keeps its result** (a passed suite stays passed), with a warning: "Passed, but teardown failed: …". You also get a notice when the run ends, because test data may have been left behind |

::: tip Write teardown so it can run twice
Teardown can run after a failed or half-finished setup. Delete by the values you created (for example by `testsuite.runId`), and don't fail if a row is already gone.
:::

## Run alone

When you press **Run all**, suites run at the same time to finish sooner. They share the same databases, so one suite's test data can show up in another suite's results.

Two ways to avoid that:

1. **Make data unique** with `testsuite.runId` (recommended). Suites then never see each other's rows.
2. Tick **Run alone** for suites that need the database to themselves, for example one that counts all rows. Those suites run one by one, after all the others have finished.

## Settings and databases

Setup and teardown use the same settings as the suite, including its [overrides](./overrides). If the suite points a database at a test copy, setup and teardown write to that test copy too.
