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
process). The workflow suite below covers the first two against a real broker;
the process split is still nobody's.

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
| `none` | — | graphs that touch no database |

The workflow suite starts one more container, `nats:2.14-alpine`, on the same
lazy terms. It is pinned to the minor the deployment runs: the job consumer uses
multi-subject filters (2.10+), and a work-queue stream's one-consumer-per-subject
rule is something these tests rely on.

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

## Workflows

`workflows/` holds graphs that are *queued*, not called, and `tests/workflow.test.ts`
runs them against a real NATS container. This is the transport the route suite
bypasses, and it is where workflow failures actually happen — a consumer that
never gets created, an artifact that never lands, a failed run that is acked
instead of retried:

```
putArtifact -> KV watch -> compiled runtime
enqueueJob  -> JetStream work queue -> job worker -> workflow handler
```

Only the process split is missing. A deployment puts the graph in a child
process and the broker in the supervisor; here they share one, which is what
lets a test observe the run at all.

A workflow answers nobody, so there is no response to assert on. What it did to
the outside world is the only evidence, and `runWorkflow` returns it:

| field | use it for |
|---|---|
| `hits` | every request the graph's HTTP blocks made, in order |
| `ok` | whether the job was acked — a failed graph is retried, then dropped |
| `attempts` | deliveries it took to settle; more than one means it was retried |
| `error` | what the last attempt threw |

`failNext(path, times)` makes the sink refuse, which is how a graph gets a
realistic reason to be redelivered.

Each test runs under a 10s ceiling — pass `WORKFLOW_TIMEOUT_MS` as the test's
timeout. The container starts once in `beforeAll`, outside that budget. The
worker is configured for 3 deliveries 250ms apart rather than the production 5
at 10s, because what is under test is the retry, not its pacing.

Two things about these fixtures are worth copying:

- A response block ends the run but returns nothing. Where it sits decides
  whether a failure is retried: `rescue.json`'s error handler ends on a
  terminal, so the run settles as successful and the queue acks it. Drop that
  terminal and the same graph is redelivered instead.
- `getConfig` is how a graph reaches the sink, because the port is only known at
  runtime. It is also how a real workflow would read a base URL.

## Custom blocks

`blocks/` holds custom blocks in the shape the portal saves them — a graph plus
the `inputParams` its callers configure. A route fixture names the ones it calls
in `uses`, and the harness registers them before compiling the route, which is
the same order the real compiler works in: a caller only emits once the library
knows the name.

`blocks/jwt-ops.json` is the worked example. One block, two input params
(`operation`, `failOnInvalid`), and three routes under `graphs/custom-blocks/`
that configure it differently — signing, lenient verification, and strict
verification that ends on the block's *own* response block. Worth copying:

- Read config as `params.<name>` inside the block, at any depth. `input` is the
  previous block's output, exactly as in a route.
- The callee's spans land in the caller's trace, so `executed` shows the inner
  block ids inline. Assert on them — that is what distinguishes "the block ran"
  from "the caller returned something".
- A response block inside a custom block ends *the block*, handing
  `{ httpCode, body }` back to the caller. The caller still chooses the status.

The secret is hardcoded in the block. It should come from app config, which
custom block params cannot reference yet.

## Adding a graph

1. Drop a JSON file in `graphs/`, or in a subfolder for a multi-endpoint
   feature. The `blocks` and `edges` shapes are exactly what the canvas saves,
   so a fixture can be pasted out of a real project. `name` must match the file
   path; set `"engine"` if it is not Postgres.

   Branch edges carry the handle on **`toHandle`**, not `fromHandle` — that is
   the field the compiler reads. An `if` whose two edges both say
   `"toHandle": "source"` fails to compile with a fan-out error.
2. Point any db block's `connection` at `"primary"` — the harness wires that id
   to the right container for the fixture's engine. A graph with no db block
   should set `"engine": "none"` so no container starts for it.
3. Add a test file in `tests/` with `beforeEach(() => resetDatabase(engine))`
   and assertions on `runGraph(fixture)`.

Seed data lives in `src/seed.ts`, one function per engine. Extend the one your
graph needs — adding a graph should not mean adding a migration.

A workflow goes in `workflows/` instead, with no `route` and no `engine`, and is
run with `runWorkflow(fixture, payload)`. Both directories are walked by
`tests/fixtures.test.ts`, so a graph that stops compiling fails there rather
than confusingly inside whichever suite loads it.

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
