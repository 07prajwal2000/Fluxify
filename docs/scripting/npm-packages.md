---
title: NPM Packages
description: Built-in libraries available in the scripting environment and the policy on external packages.
---

# NPM Packages

## Built-in Libraries

Fluxify bundles a curated set of third-party libraries directly into the scripting runtime. These are available as top-level globals in every script — no `require()`, `import`, or installation needed.

| Global | Library | Version |
| :--- | :--- | :--- |
| `dayjs` | [Day.js](https://day.js.org/) — date/time manipulation. The `utc` plugin is pre-loaded. | See `package.json` |
| `_` | [Underscore.js](https://underscorejs.org/) — functional utilities for arrays, objects, collections. | See `package.json` |
| `zod` | [Zod](https://zod.dev/) — runtime schema validation and type coercion. | See `package.json` |

```javascript
// All available without any import:
const now = dayjs().utc().toISOString();
const filtered = _.filter(input.items, i => i.active);
const schema = zod.object({ name: zod.string() });
```

These libraries are injected via the `libs` property of the [Execution Context](../concepts/context.md) and exposed as globals by the VM.

---

## Arbitrary NPM Packages — Not Supported

The scripting environment does **not** support importing arbitrary NPM packages using `require()` or ES module `import` syntax. This is intentional:

- **Security**: Arbitrary imports could expose the server's filesystem or internal modules.
- **Isolation**: The V8 sandbox restricts module resolution by design.
- **Predictability**: A curated set of globals ensures consistent behavior across deployments.

Calling `require("lodash")` or `import ... from "..."` inside a script will result in a `ReferenceError`.

---

## Recommended Alternatives

| Need | Recommended approach |
| :--- | :--- |
| Date formatting / manipulation | Use built-in `dayjs` global |
| Array / object utilities | Use built-in `_` (Underscore.js) |
| Input validation | Use built-in `zod` global |
| Simple math or string ops | Use native JavaScript (ES6+) |
| Complex collection operations | Use the **Array Operations** block |
| External API calls | Use `httpClient` global or the **HTTP Request** block |
| Secrets / config | Use `getConfig("KEY")` global |

---

## For Platform Developers

If you are contributing to the Fluxify codebase itself (not scripting workflows), the full set of internal npm dependencies is managed by the monorepo. See the [Contributing Guide](/getting-started/contributing) for information about workspace packages, the `@fluxify/lib` package, and how `JsVM` injects the `libs` object.
