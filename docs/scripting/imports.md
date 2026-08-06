---
title: Imports & Libraries
description: Use import statements in your scripts, and the libraries available to every script without one.
---

# Imports & Libraries

Scripts can load modules with standard `import` syntax, and a few common libraries are always available without importing anything at all.

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

Imports are lifted out of your script when the workflow is saved and loaded a single time, before any request arrives. A route that imports ten modules is exactly as fast per request as one that imports none.

They are loaded again only when the workflow is saved again or the project is redeployed.

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

## Libraries Available Without Importing

Three libraries are provided to every script through the `libs` object. No import needed:

```javascript
libs.dayjs().utc().toISOString();
libs._.groupBy(input.users, "role");
libs.zod.object({ name: libs.zod.string() });
```

| Name | Library |
| :--- | :--- |
| `libs.dayjs` | [Day.js](https://day.js.org/) — dates and times, with the `utc` plugin already loaded. |
| `libs._` | [Underscore.js](https://underscorejs.org/) — utilities for arrays, objects, and collections. |
| `libs.zod` | [Zod](https://zod.dev/) — schema validation and parsing. |

These are the same libraries you can also import by name, so `libs.dayjs` and `import dayjs from "dayjs"` give you the same thing. Use whichever reads better.

## Notes

- **TypeScript type imports are ignored.** `import type { Foo } from "bar";` is removed and loads nothing, which is the correct behaviour — there are no types at runtime.
- **`require()` is not supported.** Use `import`.
- **Imports must be at the start of a line.** An `import` written inside a string or a comment is left alone, as you would expect.

## See Also

- [Scripting Context](./context.md) — everything else available inside a script.
- [Execution Limits & Safety](./key-considerations.md) — timeouts and other runtime constraints.
