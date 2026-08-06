# Graph end-to-end tests

Real graph JSON, compiled by the real compiler, run against a real database
through the real request path. What these catch that the block unit specs in
`packages/blocks/builtin/tests` cannot: everything between a graph and a
response.

```bash
bun run test:e2e
```

Needs a Docker daemon. Locally that means `localhost:2375` ("expose daemon
without TLS" in Docker Desktop) — the same requirement the adapter integration
tests already have. CI uses the mounted socket.

## What runs

A fixture's blocks and edges go through `compileGraph`, and the result is
installed on the same `setBlocksExecutor` seam a compiled worker uses. The
request then travels the production path: context vars, request schema
validation, block execution, response shaping.

Bypassed: artifact transport (NATS KV, the supervisor, the isolated execution
process). Those seams are worth covering, but they are a different suite.

One container per engine is shared by the entire run and torn down once at the
end. They start lazily, so an engine no fixture asks for never launches.
Isolation comes from re-seeding in a `beforeEach`, not from restarting the
server.

## Engines

A fixture declares its engine; Postgres is the default.

| `engine` | container | fixtures |
|---|---|---|
| `pg` | `postgres:bullseye` | `users`, `orders`, `auth_users` |
| `mongo` | `mongo:7.0`, single-node replica set | `todos` |

Graphs are written **per engine**, not run across all of them. The adapters do
not agree on what a result looks like — Mongo ids are hex strings off `_id`,
joins have no equivalent — so a shared assertion would have to be weakened until
it stopped proving much. Each engine gets graphs that exercise what is
distinctive about it.

The replica set exists so a future `db_transaction` fixture does not need a
different container than every other Mongo one.

## Feature folders

A feature whose endpoints only make sense together gets a subfolder, and its
fixtures are named by path — `graphs/auth/login.json` loads as `auth/login`.
`graphs/auth/` is the worked example: signup, email verification, login,
session, profile and logout, sharing one `auth_users` table and one JWT secret.

Two things there are worth copying. Request validation is declared on the
fixture's `schemas`, not built out of `libs.zod` inside a block — that is the
route-level schema the portal stores, and it runs before any block does, so a
400 costs zero blocks. And the accounts come from seeded faker
(`AUTH_USERS` in `src/seed.ts`), which keeps the plaintext passwords available
to the tests: a login test posts one, and the storage test hashes one and
compares it against the column read straight out of Postgres.

## Adding a graph

1. Drop a JSON file in `graphs/`, or in a subfolder for a multi-endpoint
   feature. The `blocks` and `edges` shapes are exactly what the canvas saves,
   so a fixture can be pasted out of a real project. `name` must match the file
   path; set `"engine"` if it is not Postgres.

   Branch edges carry the handle on **`toHandle`**, not `fromHandle` — that is
   the field the compiler reads. An `if` whose two edges both say
   `"toHandle": "source"` fails to compile with a fan-out error.
2. Point any db block's `connection` at `"primary"` — the harness wires that id
   to the right container for the fixture's engine.
3. Add a test file in `tests/` with `beforeEach(() => resetDatabase(engine))`
   and assertions on `runGraph(fixture)`.

Seed data lives in `src/seed.ts`, one function per engine. Extend the one your
graph needs — adding a graph should not mean adding a migration.

## Asserting

`runGraph` returns the response *and* the execution trace:

| field | use it for |
|---|---|
| `status`, `body` | what the client receives |
| `executed` | which block ids actually ran, in order |
| `spans` | per-block input, output, outcome and branch |
| `source` | the generated JavaScript, for compilation assertions |

Assert on `executed` as well as `body`. A response alone cannot distinguish a
working graph from one whose real work was skipped by a branch that silently
evaluated to the wrong side — that exact failure has shipped before.
