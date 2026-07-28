# Harness Events — the wire contract

Everything the AI harness tells a client goes through **one event shape**. There
are no other event kinds, no per-node message formats, and no side channels.
This document is the single source of truth for the client.

Type definitions live in `clientContract.ts` — the only harness module a browser
bundle may import (it has zero runtime imports, so it never drags langgraph,
drizzle or the DB layer into the frontend).

---

## 1. The event

```ts
interface HarnessStreamEvent {
  conversationId: string;
  runId: string;

  currentNode:      HarnessEventNode;      // which graph node is talking
  nodeId:           string;                // which *instance* of it
  nodeStatus:       "started" | "running" | "ended";
  executionType:    "agent" | "tool";
  toolName?:        string;                // set iff executionType === "tool"
  plainTextMessage: string;                // one sentence, render verbatim

  runStatus: HarnessRunStatus;             // the run's overall state
  level:     "harness" | "sub_agent";
  payload?:  HarnessNodePayload;           // structured data, when there is any
  timestamp: number;                       // epoch ms
}
```

### `currentNode`

The graph node the event is about. One of:

| Value | Who |
| --- | --- |
| `router` | Decides discussion vs. build |
| `verifyUserQuery` | Checks the request is buildable |
| `planner` | Writes the implementation plan |
| `humanInTheLoop` | Parks the run for plan review |
| `taskGenerator` | Splits the plan into tasks |
| `orchestrator` | Dispatches the next ready task level |
| `blockBuilder` | Sub-agent — builds workflow blocks |
| `routeConfig` | Sub-agent — creates/updates/deletes a route |
| `supervisor` | Reviews sub-agent output |
| `summarizer` | Writes the final summary |
| `discussion` | Answers a non-build question |
| `run` | **Synthetic.** Run-level bookends only — not a graph node |

### `nodeId` — the key you group by

`currentNode` is *not* unique: the orchestrator runs once per task level, and
several `blockBuilder`s run **concurrently** for different tasks. `nodeId`
disambiguates:

```
"planner"                 singleton node
"blockBuilder:task-7"     sub-agent instance working on task-7
"blockBuilder:task-8"     a different instance, running at the same time
"run"                     the run-level bookend
```

**Use `nodeId` as your React key / map key.** It is stable across every event of
one execution — `started`, all `running` updates, every tool call, and `ended`.

### `nodeStatus`

| Value | Meaning |
| --- | --- |
| `started` | The node (or tool) was entered. |
| `running` | Progress from inside it. Any number of these, including zero. |
| `ended` | The node (or tool) finished. Carries `payload` when it produced something. |

### `executionType`

| Value | Meaning |
| --- | --- |
| `agent` | The node is reasoning / calling the model. |
| `tool` | A tool is executing **inside** that node. `toolName` is set. |

A tool call is a nested `started`/`ended` pair carrying the **same `nodeId`** as
the node that requested it. So:

> An `ended` event with `executionType: "tool"` does **not** mean the node
> finished. Only `executionType: "agent"` + `nodeStatus: "ended"` does.

### `plainTextMessage`

Always present, always non-empty, always one short sentence in plain English.
This is what you show the user. Examples:

```
Understanding your request
Drafting an implementation plan
Searching the documentation…
Looking up project resources — found 3 routes
Building workflow blocks
The planner hit a hiccup and is retrying (attempt 1/3) — the model returned malformed JSON
All done
```

Never parse it. If you need to branch, branch on `currentNode`, `nodeStatus`,
`executionType` or `runStatus`.

### `runStatus`

`queued` → `routing` → `verifying` → `planning` → `orchestrating` → `executing`
→ one of `completed` | `failed` | `interrupted` | `awaiting_hitl`.

Terminal values are exported as `TERMINAL_RUN_STATUSES`. `awaiting_hitl` is
terminal-but-resumable: the run pass is over, but the user can approve/review
the plan and a **new run pass** starts.

### `level`

`sub_agent` for `blockBuilder` and `routeConfig`; `harness` for everything else.
Useful for indenting sub-agent rows under the orchestrator.

---

## 2. Run bookends — where a run starts and stops

Every run opens and closes with a `currentNode: "run"` event.

**Open** — emitted before anything can fail, including the AI-provider probe:

```jsonc
{
  "currentNode": "run", "nodeId": "run",
  "nodeStatus": "started", "executionType": "agent",
  "plainTextMessage": "Starting on your request",
  "runStatus": "queued", "level": "harness"
}
```

**Close** — the one and only "this run is over" signal, carrying the full result:

```jsonc
{
  "currentNode": "run", "nodeId": "run",
  "nodeStatus": "ended", "executionType": "agent",
  "plainTextMessage": "All done",
  "runStatus": "completed", "level": "harness",
  "payload": {
    "node": "run",
    "data": {
      "runStatus": "completed",
      "result": "## What I built\n...",   // final markdown
      "artifactId": "art_123",            // when a summary artifact was saved
      "error": undefined                  // set on failed / interrupted
    }
  }
}
```

```ts
const isRunOver =
  event.currentNode === RUN_NODE && event.nodeStatus === "ended";
```

Do **not** infer termination from a terminal `runStatus` alone — intermediate
events can legitimately carry `awaiting_hitl` before the run actually closes.

`payload.data.result` is the final markdown for every outcome:

| Outcome | `result` |
| --- | --- |
| `completed` | summary markdown, or the discussion answer |
| `awaiting_hitl` | the plan awaiting review |
| `failed` | a user-readable failure explanation; `error` has the raw message |
| `interrupted` | "Conversation was interrupted by the user…" |

---

## 3. Structured payloads

`payload` appears on node `ended` events (and the HITL notice) for nodes that
produce data. It is a discriminated union on `payload.node`:

| `payload.node` | `payload.data` |
| --- | --- |
| `router` | `{ intent, reason }` |
| `verifyUserQuery` | `{ capable, rejectReason }` |
| `planner` | `{ markdownPlan, scratchpadNote, confidenceScore, implementationComplexity }` |
| `discussion` | `{ markdown }` |
| `taskGenerator` | `{ tasksByLevel }` |
| `orchestrator` | `{ tasksByLevel, activeLevel }` |
| `supervisor` | `{ tasksByLevel }` |
| `blockBuilder` / `routeConfig` | `{ task, result }` |
| `summarizer` | `{ markdown, artifactId }` |
| `humanInTheLoop` | `{ reason, markdownPlan }` |
| `run` | `HarnessRunResult` (see above) |

`tasksByLevel` is `HarnessTaskView[][]` — the task DAG grouped into topological
levels, recomputed from scratch every time. **Replace it wholesale; never merge.**

Tool events never carry a payload — only `toolName` and `plainTextMessage`.

---

## 4. Transport

| Property | Value |
| --- | --- |
| Library | `socket.io-client` v4 |
| URL | same origin as the web app |
| `path` | `SOCKET_PATH` from `clientContract` (`/_/admin/api/ai/socket.io/`) |
| `withCredentials` | **`true`** — the better-auth session cookie rides the handshake |
| Event name | `HARNESS_SOCKET_EVENT` (`"conversation"`) |

Auth happens **during the handshake**. No valid session → the connection is
refused with `connect_error` / `"unauthorized"`. There is no half-open state, and
a socket only ever receives its own user's conversations.

```ts
import {
  SOCKET_PATH,
  HARNESS_SOCKET_EVENT,
  type HarnessSocketMessage,
} from "@fluxify/ai-gateway/src/harness/clientContract";

const socket = io(window.location.origin, {
  path: SOCKET_PATH,
  withCredentials: true,
});

socket.on(HARNESS_SOCKET_EVENT, (message: HarnessSocketMessage) => { ... });
```

### The two message types

```ts
type HarnessSocketMessage =
  | { type: "full_state"; conversations: HarnessSnapshot[] }
  | { type: "update"; conversationId: string; runId: string; event: HarnessStreamEvent };
```

`full_state` is the **catch-up**: on every connect (and whenever the client
emits `"sync"`), the server replays the entire event queue of every in-flight
conversation the user owns.

```ts
interface HarnessSnapshot {
  conversationId: string;
  runId: string;
  runStatus: HarnessRunStatus;
  currentNode?: HarnessEventNode;
  currentLevel?: HarnessLevel;
  events: HarnessStreamEvent[];   // the replayed queue, oldest first
  updatedAt: number;
}
```

The replayed events are byte-identical to the live ones, so **run both through
the same reducer**. That is the whole point of the design: one code path,
idempotent, order-independent.

---

## 5. Storage guarantees

Events are appended to a per-run Redis queue as they are emitted, and stay there
for the entire run — regardless of how it ends (success, failure, interrupt, or
HITL pause). A client that connects halfway through a run gets everything that
already happened.

| | |
| --- | --- |
| Queue key | `harness:run:<runId>:snapshot` |
| Retained while running | 6 hours (safety net; a run never gets near it) |
| Retained after the run ends | 60 seconds, then evicted |
| Bounded at | the last **500** events (oldest dropped first) |

Two consequences for the client:

1. **An `ended` can arrive with no `started`** if the queue overflowed on a very
   long run. Your step upsert must create as readily as it updates.
2. **Reconnecting more than 60s after a run finished** yields a snapshot with an
   empty `events` array and a DB-sourced `runStatus`. Merge it; never let it
   delete a run you already have.

---

## 6. What a run looks like on the wire

### Discussion (a question, not a build)

```
run              started   queued          Starting on your request
router           started   routing         Understanding your request
router           running   routing         routing query
router           ended     routing         Request understood            → payload.router
discussion       started   planning        Thinking about your question
discussion       running   planning        thinking
discussion  TOOL started   planning        Searching the documentation…
discussion  TOOL ended     planning        Searching the documentation — found 4 results
discussion       ended     planning        Answer ready                  → payload.discussion
run              ended     completed       All done                      → payload.run
```

### Build, with plan review (HITL)

```
run              started   queued          Starting on your request
router           started/…/ended
verifyUserQuery  started/…/ended                                         → payload.verifyUserQuery
planner          started   planning        Drafting an implementation plan
planner     TOOL started   planning        Looking up project resources…
planner     TOOL ended     planning        Looking up project resources — found 3 routes
planner          running   planning        generating plan
humanInTheLoop   running   awaiting_hitl   Waiting for you to review the plan → payload.humanInTheLoop
planner          ended     planning        Plan ready                    → payload.planner
humanInTheLoop   started   awaiting_hitl   Waiting for your review
humanInTheLoop   ended     awaiting_hitl   Review received
run              ended     awaiting_hitl   Paused — the plan is waiting for your review → payload.run
```

The user then approves / requests changes / rejects, which starts a **new run
pass** with its own `run started … run ended` bookends. On approve/review the
graph enters past the router, so the second pass emits an extra run-level
`running` event ("Resuming at the task generator") right after its bookend.

### Build, executing tasks

```
run              started   queued
router / verifyUserQuery / planner …
taskGenerator    started   orchestrating   Breaking the plan into tasks
taskGenerator    ended     orchestrating   Tasks ready                   → payload.taskGenerator
orchestrator     started   orchestrating   Scheduling the next tasks
orchestrator     ended     orchestrating   Tasks scheduled               → payload.orchestrator
routeConfig      started   executing       Configuring the API route      nodeId routeConfig:task-1
routeConfig TOOL started   executing       Reading route details…         nodeId routeConfig:task-1
routeConfig TOOL ended     executing       Reading route details — done   nodeId routeConfig:task-1
routeConfig      ended     executing       Route configured               nodeId routeConfig:task-1
supervisor       started   orchestrating   Reviewing task results
supervisor       ended     orchestrating   Review finished               → payload.supervisor
orchestrator     started   orchestrating   ← next level, same node, same nodeId
blockBuilder     started   executing       Building workflow blocks       nodeId blockBuilder:task-2  ┐ concurrent
blockBuilder     started   executing       Building workflow blocks       nodeId blockBuilder:task-3  ┘
blockBuilder     ended     executing       Blocks built                   nodeId blockBuilder:task-3
blockBuilder     ended     executing       Blocks built                   nodeId blockBuilder:task-2
supervisor       started/ended ×2
summarizer       started   orchestrating   Summarising the changes
summarizer       ended     orchestrating   Summary ready                 → payload.summarizer
run              ended     completed       All done                      → payload.run
```

### Failure

Any failure — a dead AI provider, a mid-graph throw, a user interrupt — closes
with the same bookend:

```
run              ended     failed          Failed at the planner          → payload.run
                                                                            .data.result = explanation
                                                                            .data.error  = raw message
```

---

## 7. Client rules

These are the non-obvious ones. Every one of them corresponds to a real
behaviour of the server, not a hypothetical.

1. **One reducer for both message types.** `full_state` events and live
   `update` events are the same shape and overlap freely. Applying an event
   twice must be a no-op.

2. **Guard on `timestamp`, not arrival order.** Ordering is guaranteed per
   connection only. A live update can beat the connect snapshot. Never let an
   older event overwrite a newer field.

3. **Key steps by `nodeId`.** Not by `currentNode` (sub-agents collide) and not
   by array index (events interleave).

4. **A tool `ended` does not end the node.** Check `executionType === "agent"`.

5. **`isTerminal` comes only from the run bookend** — `currentNode === "run" &&
   nodeStatus === "ended"`. Not from `runStatus` alone.

6. **A node `started` for anything other than `humanInTheLoop` clears the HITL
   prompt** — it means the user's decision was accepted and work resumed.

7. **Replace `tasksByLevel`, never merge it.** It is a full recompute of the DAG.

8. **Reconnect re-merges `full_state`.** socket.io reconnects automatically and
   the server re-sends the catch-up; merge it, never replace your run map. A run
   missing from a later snapshot has aged out of Redis, not ceased to exist.

9. **Multiple runs interleave on one socket.** Always route by
   `event.conversationId`.

10. **Retry notices are ordinary `running` events.** They read
    "…is retrying (attempt 1/3) — <reason>". Render or filter them deliberately;
    they are not failures.

The reference implementation of all of this is
`apps/portal/src/store/aiHarness.ts` (`applyEvent` / `applySnapshot`), with the
node-specific projections isolated in `harnessNodeReducers.ts`.

---

## 8. Server-side extension points

| Change | Where |
| --- | --- |
| New node entry/exit sentence | `NODE_MESSAGES` in `streamTypes.ts` |
| New tool sentence | `TOOL_MESSAGES` in `streamTypes.ts` |
| Mid-node progress ("found 3 routes") | `dispatchAgentEvent({ name: "agent_status", … })` from the agent; pass `agentId: task.id` in a sub-agent |
| Tool start/end events | automatic — emitted by the tool loop in `models/base.ts` |
| New structured payload | add a variant to `HarnessNodePayload`, build it in `HarnessCallbacks.buildPayload` |

Agents never construct events themselves. They dispatch a custom event; only
`HarnessCallbacks` (`callbacks.ts`) and the run bookends in `index.ts` build a
`HarnessStreamEvent`, which is what keeps the shape uniform.
