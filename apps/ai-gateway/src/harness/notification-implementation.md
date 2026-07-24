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
| `startConversationEventBridge()` | subscribe + re-emit into the in-process bus |

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
  (e.g. the local demo with an empty user table) the publish is **skipped** —
  there is no subject to publish to.
- `initializeHarnessWorker` `await`s `initializePubSub()` (idempotent) so the
  worker's NATS connection is live before any job runs. In the real app it is
  already connected at `server.ts` startup; this is a defensive re-init.
- Publish is fire-and-forget off the callbacks' serialized emit chain — the
  graph is never gated on NATS or Redis.

## Consumer side (main thread)

`runMain` calls `startConversationEventBridge()`, which subscribes to
`conversations.*`, validates, and re-emits `message.event` into
`harnessEventEmitter` keyed by `conversationId`. That in-process bus is what SSE
reads today and what socket.io rooms will read next (room per `userId`, targeted
by `conversationId`).

The old `QueueEvents("progress")` bridge in `queue.ts` was removed; the emitter
is now fed exclusively from NATS. `harnessQueue` (job add/trigger) is unchanged.

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

## Threads / connections

`server.ts` runs the same file on the main thread and a spawned worker thread;
each thread initializes its **own** NATS connection via `initializePubSub()`.
The worker thread publishes, the main thread subscribes, and the NATS broker
routes between them. In the single-process `demo.ts`, publish and subscribe
share one connection (NATS still delivers to self).

## Files touched

| File | Change |
| --- | --- |
| `harness/notifications.ts` | **new** — contract, publish, subscribe, bridge |
| `harness/notifications.spec.ts` | **new** — envelope parser tests |
| `harness/callbacks.ts` | publish instead of `job.updateProgress`; carry `userId` |
| `harness/index.ts` | resolve owner userId; publish terminals; `finalizeSnapshot` |
| `harness/internal/redisService.ts` | running vs finalize TTL; `finalizeSnapshot` |
| `harness/internal/harnessService.ts` | `getOwnerUserId()` |
| `harness/queue.ts` | drop dead QueueEvents progress bridge |
| `harness/worker.ts` | `await initializePubSub()` on worker init |
| `main.ts` | start the conversation bridge |
| `worker.ts` / `harness/demo.ts` | await async worker init; demo resolves owner |
