# Load Testing (k6)

Config-driven [k6](https://k6.io) load tests for the APIs you build.

## Layout

| File | Purpose |
| :--- | :--- |
| `index.ts` | The runner. Reads `config.ts`, builds each request, checks the response. Don't edit for normal use. |
| `config.ts` | **Edit this.** Declares `baseUrl`, the list of `requests`, and the k6 `options` (VUs, stages, thresholds). |
| `data/` | Body files referenced by `bodyFile`. `.json` files are sent as `application/json`; anything else is sent raw. |

## Run

```bash
# Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
# The enhanced compatibility mode is REQUIRED — it transpiles the TypeScript.
k6 run --compatibility-mode=experimental_enhanced index.ts

# Point at a different environment:
k6 run --compatibility-mode=experimental_enhanced -e BASE_URL=https://api.example.com index.ts
```

> Tired of the flag? `export K6_COMPATIBILITY_MODE=experimental_enhanced` once, then just `k6 run index.ts`.

## Add a request

Append to the `requests` array in `config.ts`:

```ts
{
  name: "create-user",        // label in the k6 report
  method: "POST",
  path: "/api/users",
  query: { source: "loadtest" },
  body: { name: "Ada", email: "ada@test.dev" }, // inline object -> JSON
  expectStatus: 201,
}
```

Body options (pick one):

- **Inline object** — `body: { ... }` → sent as JSON.
- **Inline raw** — `body: "raw string"` → sent as text.
- **From a file** — `bodyFile: "data/create-user.json"` → `.json` sent as JSON, otherwise raw. `bodyFile` wins over `body`.

Add custom headers with `headers: { ... }` (Content-Type is set for you from the body type but you can override it).

> Editor IntelliSense: `bun add -d @types/k6`.
