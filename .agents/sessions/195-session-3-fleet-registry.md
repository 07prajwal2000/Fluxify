# Session 3 — Worker fleet registry and admin health view (#195)

Split out of the telemetry work: this is **our** infrastructure, not the user's
telemetry. Nothing here is ever exported to a customer endpoint.

Worker CPU, in-flight requests, heartbeat age, dropped spans and restart counts
describe our fleet. Sending them to a customer's OTLP destination would be both
wrong and a topology leak. Session 1's `worker-stats` push already carries the
counters; this session adds liveness and the admin view.

## Ping is truth, DB is history

A database row saying a worker is alive is a lie the moment a pod is `SIGKILL`ed
— nothing deletes it.

- **Liveness comes from request/reply.** Only live workers answer a ping.
  Authoritative, self-correcting, no sweeper job.
- **The DB holds durable facts only**: `workerId`, first seen, last seen,
  version, project scope (`WORKER_PROJECT_ID`, may be `*`), config fingerprint,
  and whether it deregistered cleanly on `SIGTERM`. Answers "how many did we have
  at 03:00", autoscale accounting, and which worker vanished without
  deregistering. **Never** answers "is it alive right now".
- Admin panel = live ping ⟕ DB rows. A row with no ping reply is dead or scaled
  down; the clean-deregistration flag separates the two.

## The bus already exists

`apps/server/src/db/natsRpc.ts` — typed envelope, gzip above 32 KiB, typed error
codes, `RpcCaller` identity. This is **a new subject on it, not new
infrastructure**.

**Trap:** `rpcRespond` queue-subscribes (`queue = "fluxify.ops"`,
`natsRpc.ts:153`) so exactly one replica answers. Correct for ops calls, **wrong
for a fleet ping** where every worker must reply. The responder needs a plain
non-queue `subscribe` — either a `queue: false` option or a sibling
`rpcRespondAll`.

Verified in `nats@2.29.3`:

- `requestMany(subject, payload, opts)` → `QueuedIterator<Msg>` (`core.d.ts:476`).
- `RequestManyOptions = { strategy, maxWait, maxMessages?, jitter?, ... }`
  (`core.d.ts:322`). `RequestStrategy.Timer` collects every reply until `maxWait`.
- **No `micro`/`$SRV` services module in v2** (that is `@nats-io/services` in v3).
  Do not reach for it.

## Why RPC and not just the stats push

The periodic `worker-stats` push gives counters but no liveness — silence is
indistinguishable from "never existed". Keep the push for counters; take liveness
from the ping. The RPC is also the extension point: "report status", "dump
config" and future commands are **new payload types on an existing subject**, not
new infrastructure.

## Work

1. Subject + payload types beside `RPC_SUBJECTS` (`natsRpc.ts:27`). Responder in
   the supervisor (`compiledWorker.ts`) — **supervisor-side, never the child**: a
   wedged execution process cannot answer, and that silence is itself the signal.
2. Non-queue responder helper (`queue: false` or `rpcRespondAll`).
3. `workers` table + migration. Boot announce, periodic touch, clean deregister on
   `SIGTERM`.
4. Admin API: `requestMany` fan-out joined against the table.
5. Admin list view in `apps/portal`. `apps/web` is legacy — leave it.

## Caution

`requestMany` fan-out is O(fleet) replies to one requester. Fine at tens or
hundreds; set `maxMessages` and paginate before it is thousands.

## Still rejected

**No Prometheus for fleet health, in cloud either.** A TSDB earns its keep for
PromQL, alerting and weeks of history; a worker-health panel needs current state
plus a short window, and a cloud-only path turns one screen into two code paths.
(The Prometheus in `docker-compose.yml` is there to receive *user* route metrics
over OTLP push — `--web.enable-otlp-receiver`, `scrape_configs: []` — not to
scrape our workers.) If cloud later wants long retention, aggregate rows go to PG
beside the traces: same shape, no new component.

## Done when

- The admin panel lists every live worker with id, project scope and stats, and
  distinguishes scaled-down from vanished.
- A `SIGKILL`ed worker disappears from the live list with no sweeper job.
- No worker-level metric ever reaches a customer endpoint.
