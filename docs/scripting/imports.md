---
title: Imports & Libraries
description: Use import statements in your scripts, and the libraries available to every script without one.
---

# Imports & Libraries

Scripts can load modules with standard `import` syntax, and a few common libraries are always available without importing anything at all.

## Bun runtime

Imports and generated route code run in Bun's JavaScript runtime, not Node.js. Bun uses Apple's JavaScriptCore engine, and scripts can use native APIs on the `Bun` global where they are available to the worker. Refer to the [Bun runtime API reference](https://bun.com/docs/runtime/bun-apis) for the complete API surface.

The worker supervisor is intentionally strict about unhealthy execution. Its watchdog is experimental and only partially implemented today: it can terminate a worker when an enabled route timeout is exceeded and execution has stalled, while broader CPU and network-usage policies remain in progress. Enable `experimental.workerTimeouts.enabled` to enforce the configured timeout for each endpoint; the default is 30 seconds.

## Import Statements

Write imports at the top of your script, exactly as you would in a normal JavaScript file:

```javascript
import { randomUUID } from "crypto";
import dayjs from "dayjs";

return { id: randomUUID(), at: dayjs().toISOString() };
```

Every form of the syntax works:

| Form | Example |
| :--- | :--- |
| Named | `import { readFile } from "fs/promises";` |
| Renamed with `as` | `import { readFile as read } from "fs/promises";` |
| Default | `import dayjs from "dayjs";` |
| Everything, as one object | `import * as path from "path";` |
| Default plus named | `import zod, { z } from "zod";` |
| For its side effects only | `import "some-module";` |

## Imports Run Once, Not Per Request

When a workflow is saved, Fluxify's AST parser extracts static imports from its scripts and the DAG compiler hoists them out of the route handler. Bun resolves them once for the compiled route, before any request arrives. A route that imports ten modules does not repeat that import work per request.

They are loaded again only when the workflow is saved again or the project is redeployed.

Repeated imports of the same module across blocks are combined into one route-level import at load time. You can import the same module where it makes the local script clearer without creating a per-request performance bottleneck.

::: tip
This is why `import` is preferred over loading a module inside your code at runtime. Both work, but only the `import` form is lifted out of the request path.
:::

## What You Can Import

| | |
| :--- | :--- |
| **Built-in platform modules** | `crypto`, `path`, `fs`, `url`, `zlib`, and the rest of the standard runtime modules. |
| **Bundled libraries** | `dayjs`, `zod`, `underscore`, `jsonwebtoken` |
| **Anything else** | Not available. Arbitrary packages cannot be installed per project. |

Importing a module that is not available fails the request with a clear error naming the module, rather than failing silently.

## Imports Are Shared Across the Whole Workflow

All imports in a workflow are gathered together, so a name you import in one script is visible to every other script in that same workflow — you do not have to repeat the import in each block.

The trade-off is that a name means one thing per workflow. Importing the same name from two different modules is rejected when the workflow is saved:

```javascript
// In one block:
import parse from "path";
// In another block — rejected:
import parse from "url";
```

Rename one of them with `as` to resolve it.

An imported name also takes priority over a workflow variable of the same name. If you have a variable called `path` and you also `import path from "path"`, your scripts will see the module.

## Generated Worker Names

Workers run the compiled route as minified JavaScript. The generated handler uses internal globals, so an import that reuses one of those names can collide with generated code and cause unnecessary runtime errors.

Use specific, descriptive aliases for imports and do not import a name that is already supplied by the scripting context (such as `input`, `jwt`, `logger`, or `httpClient`). If a name conflicts, rename the import:

```javascript
// Avoid a generic name that could collide with generated code:
import { parse as parsePath } from "path";
```

## Libraries Available Without Importing

Four libraries are provided to every script without requiring an import:

```javascript
libs.dayjs().utc().toISOString();
libs._.groupBy(input.users, "role");
libs.zod.object({ name: libs.zod.string() });
jwt.sign({ userId: input.id }, getConfig("JWT_SECRET"));
```

| Name | Library |
| :--- | :--- |
| `libs.dayjs` | [Day.js](https://day.js.org/) — dates and times, with the `utc` plugin already loaded. |
| `libs._` | [Underscore.js](https://underscorejs.org/) — utilities for arrays, objects, and collections. |
| `libs.zod` | [Zod](https://zod.dev/) — schema validation and parsing. |
| `jwt` | JWT signing, verification, and decoding backed by [`jsonwebtoken`](https://www.npmjs.com/package/jsonwebtoken). |

`libs.dayjs`, `libs._`, and `libs.zod` are the same libraries you can also import by name. `jwt` is already available as a global helper and uses `jsonwebtoken` under the hood. Use whichever reads better for the `libs` packages; no import is needed for `jwt`.

## Notes

- **TypeScript type imports are ignored.** `import type { Foo } from "bar";` is removed and loads nothing, which is the correct behaviour — there are no types at runtime.
- **`require()` is not supported.** Use `import`.
- **Imports must be at the start of a line.** An `import` written inside a string or a comment is left alone, as you would expect.

## See Also

- [Scripting Context](./context.md) — everything else available inside a script.
- [Execution Limits & Safety](./key-considerations.md) — timeouts and other runtime constraints.
