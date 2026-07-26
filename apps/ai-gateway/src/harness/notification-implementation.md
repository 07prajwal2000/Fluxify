# Harness Notifications — Architecture Notes

How harness run progress reaches clients after the move off BullMQ job progress
onto NATS pub/sub. Covers only the backend wiring in `apps/ai-gateway`.

## Why

BullMQ `job.updateProgress` → `QueueEvents("progress")` → local `EventEmitter`
did not survive reconnects and scaled poorly (single QueueEvents connection per
process, no cross-instance fan-out). A user can also run **multiple** harness
sessions at once, so updates are keyed per **conversation owner**, not per job.

BullMQ still owns **triggering** runs (persistent, retry-safe). Only the
**progress stream** moved to NATS.

## Subject scheme

```
conversations.<userId>      ← publish target (one per conversation owner)
conversations.*             ← gateway subscribes to the wildcard
```

One subject per owner is enough to fan every one of a user's concurrent sessions
out to their sockets. `conversationId` rides inside the payload so a future
socket.io layer can route to a room per conversation while subscribing per user.

## Message contract — `notifications.ts`

Messages are a zod **discriminated union** on `type` (`z.discriminatedUnion`),
so new kinds stay type-safe and parseable. Today there is one variant:

```ts
{
  type: "harness_event",            // discriminant (ConversationMsgType.HARNESS_EVENT)
  userId, conversationId, runId,    // top-level routing/metadata
  timestamp,
  event: HarnessStreamEvent         // the original progress payload, unchanged
}
```

- `conversationMessageSchema` validates the **envelope** strictly.
- `event` is carried as the internally-produced, already-TS-typed
  `HarnessStreamEvent`; it is guarded shallowly (`z.custom` — must be an object
  with a string `conversationId`) rather than re-validated field-by-field. The
  nested `HarnessNodePayload` union is **not** duplicated in zod.
- Malformed / non-JSON messages on the wildcard are dropped with a warn, never
  thrown.

Exports:

| Symbol | Role |
| --- | --- |
| `conversationSubject(userId)` | builds `conversations.<userId>` |
| `CONVERSATIONS_WILDCARD` | `conversations.*` |
| `publishHarnessEvent(userId, event)` | wrap event in envelope, publish |
| `subscribeConversations(handler)` | validated wildcard subscription → async unsubscribe |

## Transport

NATS client is the existing one from `@fluxify/server` (re-exported through
`db/redis.ts`): `publishMessage`, `subscribeToChannel`, `initializePubSub`.
Nothing new was added to the server package.

## Producer side (worker thread)

```
BullMQ job → FluxifyHarness.executeGraph
  └─ getOwnerUserId() once per run  (conversations.userId, FK → system_users)
  └─ HarnessCallbacks.emit(event)   per node lifecycle event
  └─ emitTerminal(event)            on completed / failed / awaiting_hitl
        each: redisService.appendEvent(event)         (redis snapshot KV)
              publishHarnessEvent(userId, event)       (NATS)
```

- Owner `userId` is resolved **once** in `executeGraph` and threaded into
  `HarnessCallbacks` and the terminal emitters. If a conversation has no owner
  the publish is **skipped** — there is no subject to publish to.
- `initializeHarnessWorker` `await`s `initializePubSub()` (idempotent) so the
  worker's NATS connection is live before any job runs. In the real app it is
  already connected at `server.ts` startup; this is a defensive re-init.
- Publish is fire-and-forget off the callbacks' serialized emit chain — the
  graph is never gated on NATS or Redis.

## Consumer side (main thread)

`runMain` calls `initializeHarnessSocket()` (see below), which subscribes to
`conversations.*`, validates each message, and fans it to the owner's socket.io
room. That is the only consumer of the subject; there is no in-process
`EventEmitter` bridge.

The old `QueueEvents("progress")` bridge in `queue.ts` was removed; `harnessQueue`
(job add/trigger) is unchanged.

## Redis whole-run-state KV — `redisService.ts`

Key `harness:run:<runId>:snapshot` holds the run's live state (status, current
node/level, bounded event log). Written on **every** event via `appendEvent`.

TTL lifecycle:

| Phase | TTL |
| --- | --- |
| running | `RUNNING_TTL` = 6h (safety net; only leaks on a hard worker crash, self-heals) |
| terminal (completed / failed / HITL) | `finalizeSnapshot()` → `FINALIZE_TTL` = 60s |

`finalizeSnapshot` is called from both `finalizeRun` (completed + HITL) and
`failRun` (failed) **after** the terminal event is appended, so the key
auto-evicts ~60s after the run ends instead of being deleted instantly — late
subscribers still get a brief window to read the final state.

## Socket.io layer — `socketGateway.ts`

The client-facing edge. socket.io runs on the **Bun engine**
(`@socket.io/bun-engine`) and has no Hono adapter, so both share **one**
`Bun.serve` router in `main.ts`:

```
fetch(req, server):
  /_/admin/ai/socket.io/*  → engine.handleRequest   (socket.io transport)
  everything else          → app.fetch              (Hono)
websocket: engine.handler().websocket               (Bun native WebSocket handler)
```

The transport path is prefixed with `/_/admin/ai` (exported as `SOCKET_PATH`) so
the reverse proxy — which forwards `/_/admin/*` to this backend, alongside
`/_/admin/api/ai/v1` and `/_/admin/mcp` — routes the handshake here. Clients must
connect with `{ path: "/_/admin/ai/socket.io/", withCredentials: true }`.

`initializeHarnessSocket()` builds the server and returns `{ fetch, websocket }`
for `main.ts` to mount. It:

1. **Authenticates** every connection *before it is established* — the `io.use`
   middleware runs during the handshake, before any `connection` event, and calls
   `auth.api.getSession({ headers })` against the handshake cookies. No valid
   session → the handshake is rejected (client gets `connect_error`), so an
   unauthenticated client never connects. A user only ever joins their **own** room.
2. **Joins** the socket to `conversations:<userId>` (colon-delimited room;
   distinct from the dot-delimited NATS subject). One room per user fans all of a
   user's concurrent conversation runs to all their tabs.
3. **Catch-up** on connect: reads the Redis snapshot for every conversation the
   user has active (`activeRunId` not null) and emits a `full_state` message to
   the connecting socket only.
4. **Live fan-out**: subscribes to `conversations.*` (via
   `subscribeConversations`) and emits an `update` message to
   `conversations:<userId>` for each event.

Client contract — one event name `conversation`, payload discriminated by `type`:

| `type` | when | fields |
| --- | --- | --- |
| `full_state` | on connect | `conversations: HarnessSnapshot[]` (all active runs) |
| `update` | per live event | `conversationId`, `runId`, `stepId?`, `event` |

`conversationId` identifies which conversation an update belongs to; `stepId`
identifies the individual step. Shape is intentionally coarse for now — to be
refined with the UI (future updates should carry only the running conversation's
state, not every conversation's).

## End-to-end test — `demo.ts`

`demo.ts` exercises the whole pipeline without the frontend: it boots redis, db,
auth, NATS, the harness worker, and the socket.io server in one process, then
connects a socket.io **client** carrying a `DEMO_COOKIE` (paste a real session
cookie). It resolves the session's userId from that cookie, enqueues a run owned
by that user, and prints the `full_state` + `update` messages the client
receives until a terminal status. Run with `bun run src/harness/demo.ts`.

## Threads / connections

`server.ts` runs the same file on the main thread and a spawned worker thread;
each thread initializes its **own** NATS connection via `initializePubSub()`.
The worker thread publishes, the main thread subscribes, and the NATS broker
routes between them. In the single-process `demo.ts`, publish and subscribe
share one connection (NATS still delivers to self).

## Files touched

| File | Change |
| --- | --- |
| `harness/notifications.ts` | **new** — contract, publish, subscribe |
| `harness/notifications.spec.ts` | **new** — envelope parser tests |
| `harness/socketGateway.ts` | **new** — socket.io on Bun engine; auth, rooms, catch-up, fan-out |
| `harness/callbacks.ts` | publish instead of `job.updateProgress`; carry `userId` |
| `harness/index.ts` | resolve owner userId; publish terminals; `finalizeSnapshot` |
| `harness/internal/redisService.ts` | running vs finalize TTL; `finalizeSnapshot` |
| `harness/internal/harnessService.ts` | `getOwnerUserId()` |
| `harness/queue.ts` | drop dead QueueEvents progress bridge + unused emitter |
| `harness/worker.ts` | `await initializePubSub()` on worker init |
| `main.ts` | share Bun.serve between socket.io (`/_/admin/ai/socket.io/`) and Hono |
| `worker.ts` | await async worker init |
| `harness/demo.ts` | end-to-end socket.io client test with a session cookie |
