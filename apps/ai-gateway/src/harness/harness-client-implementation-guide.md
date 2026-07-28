# Harness Web Client Implementation Guide

How a web (React) client consumes live harness run updates over socket.io. This
is the **client-facing contract** — everything you need to build the UI without
reading the backend. Pairs with `notification-implementation.md` (the backend
wiring).

> **Golden rule:** the transport delivers events, but the client owns
> correctness. A single mishandled message (missed, applied out of order, or
> merged wrong) leaves the UI stale or inconsistent. Read the
> [Edge cases](#edge-cases--react-state-correctness) section before writing the
> reducer — it is the point of this document.

---

## 1. Connection

| Property | Value |
| --- | --- |
| Library | `socket.io-client` v4 (server is `socket.io` v4) |
| URL | same origin as the web app (`window.location.origin`) |
| `path` | **`/_/admin/api/ai/socket.io/`** — import `SOCKET_PATH` from `@fluxify/ai-gateway/src/harness/clientContract` rather than retyping it. It lives under `/_/admin/api/ai` because that is the only prefix the reverse proxies forward to the gateway (:8001); other prefixes fall through to the request worker. |
| Auth | the better-auth **session cookie**, sent automatically by the browser |
| `withCredentials` | **`true`** (required so the cookie rides the handshake cross-origin) |
| Event name | **`conversation`** (single event; discriminated by `type` inside the payload) |
| Room (server-side) | `conversations:<userId>` — you never name it; you are auto-joined |

```ts
import { io, type Socket } from "socket.io-client";

const socket: Socket = io(window.location.origin, {
  path: SOCKET_PATH, // "/_/admin/api/ai/socket.io/"
  withCredentials: true,
  // reconnection is ON by default; see §6 before changing these
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
```

### Authentication

- The browser sends the **HttpOnly** `better-auth.session_token` cookie
  automatically on the handshake — **you cannot and must not set it manually**
  (`extraHeaders`/`Cookie` is for the Node demo only; browsers forbid it).
- The server authenticates **during the handshake, before `connect` fires**. No
  valid session → the connection is **refused** and the client receives
  `connect_error` with message `"unauthorized"`. There is no half-open state.
- **The socket only ever joins the logged-in user's own room.** You cannot
  subscribe to another user. All of a user's conversations arrive on this one
  connection.

```ts
socket.on("connect_error", (err) => {
  if (err.message === "unauthorized") {
    // session expired / not logged in → send them to login, then reconnect
  }
});
```

---

## 2. The message contract

One event, `conversation`, carrying a **discriminated union** keyed by `type`:

```ts
type HarnessSocketMessage =
  | { type: "full_state"; conversations: HarnessSnapshot[] }
  | {
      type: "update";
      conversationId: string;
      runId: string;
      stepId?: string;
      event: HarnessStreamEvent;
    };
```

| `type` | When | Meaning |
| --- | --- | --- |
| `full_state` | **once per (re)connect**, and on demand (see below) | Baseline catch-up: current state of every **in-flight** conversation the user owns (status `running` / `awaiting_hitl`). |
| `update` | continuously | One live harness event. `conversationId` says which conversation; `stepId` identifies the individual step. |

**`full_state` is DB-authoritative for status.** Each entry always carries the
correct `runStatus` for the run, even when the Redis snapshot has evicted (its
TTL drops to 60s after a run finishes/parks). When the snapshot is gone the entry
still arrives but with **`events: []`** — you get the status, not the event
history. So: apply `runStatus` from every `full_state` entry; treat empty
`events` as "no history available", not "reset".

**On-demand re-sync.** The client can re-request `full_state` at any time — e.g.
right after a reconnect if it suspects it missed the connect-time catch-up:

```ts
socket.emit("sync"); // server replies with a fresh full_state to this socket
```

```ts
socket.on("conversation", (msg: HarnessSocketMessage) => {
  if (msg.type === "full_state") applyFullState(msg.conversations);
  else applyUpdate(msg); // msg.conversationId, msg.runId, msg.stepId, msg.event
});
```

---

## 3. Payload types (copy into the client)

These mirror the server types exactly. Treat them as the wire schema.

```ts
/** Which tier produced the event. */
type HarnessLevel = "harness" | "sub_agent";

/** Lifecycle phase of a single event. `warning` is non-terminal: the agent
 *  named in `node` hit a retryable error (bad structured output, a transient
 *  network blip) and is re-asking the model — it does not fail the run, and
 *  `runStatus` stays whatever that agent was already doing. */
type HarnessPhase = "node_start" | "node_end" | "status" | "hitl_required" | "warning";

/** Overall run status (mirrors the DB run status). */
type HarnessRunStatus =
  | "queued" | "routing" | "verifying" | "planning" | "orchestrating"
  | "executing" | "awaiting_hitl" | "completed" | "interrupted" | "failed";

/** Graph node names (the `node` field). */
type AgentNodeName =
  | "router" | "classifier" | "verifyUserQuery" | "planner" | "taskGenerator"
  | "discussion" | "blockBuilder" | "orchestrator" | "humanInTheLoop"
  | "routeConfig" | "supervisor" | "summarizer";

/** A single task in the DAG view. */
interface HarnessTaskView {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  assignedAgentNode: AgentNodeName;
  level: number;
}

/** The core event — the unit of everything. */
interface HarnessStreamEvent {
  conversationId: string;
  runId: string;
  stepId?: string;          // present for node_start/node_end; absent for most status/warning events
  level: HarnessLevel;
  phase: HarnessPhase;
  node: AgentNodeName;
  status: string;           // human-readable label, e.g. "Running planner"
  runStatus: HarnessRunStatus;
  payload?: HarnessNodePayload; // present mainly on node_end / hitl_required
  warning?: { attempt: number; maxAttempts: number }; // present only on phase "warning"
  timestamp: number;        // epoch ms — USE THIS for ordering/merge (see §5)
}

/** Cached per-run snapshot delivered inside full_state. */
interface HarnessSnapshot {
  conversationId: string;
  runId: string;
  runStatus: HarnessRunStatus;
  currentNode?: AgentNodeName;
  currentLevel?: HarnessLevel;
  events: HarnessStreamEvent[]; // bounded to the last 200 events (see §5)
  updatedAt: number;
}
```

### The node-typed payload (discriminated by `node`)

`event.payload` is present mostly on `node_end` (and `hitl_required`). It is a
discriminated union on `node`, so you narrow the `data` shape from `event.node`:

```ts
type HarnessNodePayload =
  | { node: "router";          data: { intent?: "discussion" | "builder"; reason?: string } }
  | { node: "verifyUserQuery"; data: { capable?: boolean; rejectReason?: string } }
  | { node: "planner";         data: { markdownPlan?: string; scratchpadNote?: string; confidenceScore?: number; implementationComplexity?: "high" | "mid" | "low" } }
  | { node: "discussion";      data: { markdown?: string } }
  | { node: "taskGenerator";   data: { tasksByLevel: HarnessTaskView[][] } }
  | { node: "orchestrator";    data: { tasksByLevel: HarnessTaskView[][]; activeLevel: number } }
  | { node: "supervisor";      data: { tasksByLevel: HarnessTaskView[][] } }
  | { node: "blockBuilder";    data: { task: HarnessTaskView; result?: SubAgentResult } }
  | { node: "routeConfig";     data: { task: HarnessTaskView; result?: SubAgentResult } }
  | { node: "summarizer";      data: { markdown?: string; artifactId?: string } }
  | { node: "humanInTheLoop";  data: { reason: string; markdownPlan?: string } };

/** Sub-agent output — shape depends on the agent; treat as opaque unless you
 *  need it. `routeConfig` → RouteConfigAgentResult, `blockBuilder` → BlockBuilderAgentResult. */
type SubAgentResult = Record<string, unknown>;
```

> **Important merge semantics:** the `tasksByLevel` arrays are the **whole task
> DAG re-computed each time** — always **replace**, never merge, the tasks for a
> conversation from the newest `orchestrator`/`taskGenerator`/`supervisor` event.

---

## 4. What a run looks like on the wire

A typical run streams (per conversation) roughly:

```
node_start router        (runStatus: routing)
node_end   router        payload.router        (intent)
node_start verifyUserQuery (verifying)
node_end   verifyUserQuery payload.verifyUserQuery
node_start planner        (planning)
node_end   planner        payload.planner       (markdownPlan)
   ── may park here ──
hitl_required humanInTheLoop  payload.humanInTheLoop (reason, markdownPlan)
status     humanInTheLoop  runStatus: awaiting_hitl   ← TERMINAL for this pass
   ── or continue ──
node_start taskGenerator   (orchestrating)
node_end   taskGenerator   payload.taskGenerator  (tasksByLevel)
node_start orchestrator
node_end   orchestrator    payload.orchestrator   (tasksByLevel, activeLevel)
node_start blockBuilder    (executing, level: sub_agent)   per task
node_end   blockBuilder    payload.blockBuilder   (task, result)
node_start supervisor
node_end   supervisor      payload.supervisor
node_start summarizer
node_end   summarizer      payload.summarizer     (markdown)
status     <node>          runStatus: completed        ← TERMINAL
```

**Terminal signal:** a message where `event.phase === "status"` **and**
`event.runStatus ∈ { "completed", "failed", "awaiting_hitl" }`. After this, no
more updates arrive for that run.

**A `warning` event can appear between any `node_start`/`node_end` pair.** It
means the agent named in `node` hit a retryable error (bad structured output,
a transient network blip) and is re-asking the model — it is **not**
terminal, does not change `runStatus`, and the same node's `node_end` still
follows once the retry succeeds (or the run eventually fails if every retry
is exhausted):

```
node_start planner        (planning)
warning    planner        "Planner hit a hiccup and is retrying (attempt 1/3) — ..."
warning    planner        "Planner hit a hiccup and is retrying (attempt 2/3) — ..."
node_end   planner        payload.planner       (markdownPlan)
```

Render it as a transient inline notice on the step (e.g. "retrying…") — don't
treat it as an error state for the step, and don't clear it only on the next
`warning`; clear it on that step's `node_end` (or its absence entirely is the
common case — most retries never need to be shown because they succeed within
milliseconds).

**HITL resume (`approve`/`review`) skips part of the cycle — see §4.1.**

### 4.1 HITL resume shortcuts

When the user responds to a paused plan, the resumed run does **not** always
restart from `router`:

| Decision | Entry point | What you'll see |
| --- | --- | --- |
| `hitl_approve` | `taskGenerator` | An immediate `status` event on `taskGenerator` (`runStatus: orchestrating`), then straight into the `taskGenerator` → `orchestrator` → sub-agents → `summarizer` sequence. No `router`/`verifyUserQuery`/`planner` events at all for this pass. |
| `hitl_review` | `verifyUserQuery` | An immediate `status` event on `verifyUserQuery` (`runStatus: verifying`), then `verifyUserQuery` → `planner` → (park again, or continue) as usual. No `router` event. |
| `hitl_reject` | *(none)* | The graph never runs. You get a single terminal `status` event with `runStatus: completed` and the run's `aiResponse` is a structured "Plan rejected" message — no `node_start`/`node_end` events precede it. |

The explicit `status` event on resume exists specifically so you have a
reliable "the run is moving again" signal even though the usual first
`node_start` (router/verify) you'd wait for may never come for this pass —
don't gate your "resumed" UI transition on seeing `router` or `verifyUserQuery`
start; gate it on `runStatus` leaving `awaiting_hitl`/`paused_hitl`.

- `stepId` is **stable across `node_start` → `node_end`** for the same step
  (it's an upsert). Use it to update a step in place.
- Sub-agent steps (`level: "sub_agent"`, nodes `blockBuilder`/`routeConfig`) can run
  **many in parallel** at the same DAG level — expect interleaving.

---

## 5. Recommended client state shape

Key everything by `conversationId`, then track steps by `stepId` and tasks by
task `id`. Never store a flat list you append to blindly.

```ts
interface ConversationUIState {
  conversationId: string;
  runId: string;
  runStatus: HarnessRunStatus;
  currentNode?: AgentNodeName;
  isTerminal: boolean;
  lastTimestamp: number;                 // newest event applied (for ordering)
  steps: Record<string, StepUIState>;    // keyed by stepId
  tasksByLevel: HarnessTaskView[][];      // replaced wholesale from payloads
  plan?: string;                          // planner.markdownPlan
  summary?: string;                       // summarizer.markdown
  hitl?: { reason: string; markdownPlan?: string };
  /** Transient — set on a `warning` event, cleared once that node's `node_end`
   *  arrives (the retry succeeded) or a new node starts. */
  warning?: { node: AgentNodeName; message: string; attempt: number; maxAttempts: number };
}

interface StepUIState {
  stepId: string;
  node: AgentNodeName;
  level: HarnessLevel;
  status: "running" | "completed";       // node_start → running, node_end → completed
  label: string;                         // event.status
  payload?: HarnessNodePayload;
  timestamp: number;
}

// top-level: Record<conversationId, ConversationUIState>
```

### The merge function (apply both `full_state` events and live `update`s through it)

```ts
function applyEvent(state: ConversationUIState, e: HarnessStreamEvent): ConversationUIState {
  // 1) Never regress overall status/node to an OLDER event.
  const isNewer = e.timestamp >= state.lastTimestamp;

  const next = { ...state };
  if (isNewer) {
    next.runStatus = e.runStatus;
    next.currentNode = e.node;
    next.lastTimestamp = e.timestamp;
    next.isTerminal =
      e.phase === "status" &&
      (e.runStatus === "completed" || e.runStatus === "failed" || e.runStatus === "awaiting_hitl");
  }

  // 2) Warning: transient, keyed by node, cleared on that node's next
  //    node_start/node_end (the retry resolved one way or the other).
  if (e.phase === "warning" && e.warning) {
    next.warning = { node: e.node, message: e.status, ...e.warning };
  } else if ((e.phase === "node_start" || e.phase === "node_end") && next.warning?.node === e.node) {
    next.warning = undefined;
  }

  // 3) Step upsert keyed by stepId (node_start/node_end share the stepId).
  if (e.stepId) {
    const prev = next.steps[e.stepId];
    // don't let an older node_start overwrite a newer node_end
    if (!prev || e.timestamp >= prev.timestamp) {
      next.steps = {
        ...next.steps,
        [e.stepId]: {
          stepId: e.stepId,
          node: e.node,
          level: e.level,
          status: e.phase === "node_end" ? "completed" : prev?.status === "completed" ? "completed" : "running",
          label: e.status,
          payload: e.payload ?? prev?.payload,
          timestamp: e.timestamp,
        },
      };
    }
  }

  // 4) Payload-driven fields — REPLACE (tasksByLevel is a full recompute).
  switch (e.payload?.node) {
    case "taskGenerator":
    case "supervisor":
      next.tasksByLevel = e.payload.data.tasksByLevel;
      break;
    case "orchestrator":
      next.tasksByLevel = e.payload.data.tasksByLevel;
      break;
    case "planner":
      if (e.payload.data.markdownPlan) next.plan = e.payload.data.markdownPlan;
      break;
    case "summarizer":
      if (e.payload.data.markdown) next.summary = e.payload.data.markdown;
      break;
    case "humanInTheLoop":
      next.hitl = e.payload.data;
      break;
  }
  return next;
}
```

`applyFullState` seeds/merges each snapshot's `events` through `applyEvent` (and
sets `runStatus`/`currentNode` from the snapshot as a floor). `applyUpdate` runs
the single `msg.event` through `applyEvent`. **Both paths share one idempotent
reducer** — that is what makes replays and races safe.

---

## 6. Edge cases — React state correctness

This is the part that makes or breaks the UI. Each item below is a real way the
naive implementation goes stale.

### 6.1 `full_state` can arrive AFTER live `update`s (race)
On connect the server joins your room **then** does an async DB+Redis read
before emitting `full_state`. A live `update` for an event happening in that
window is emitted to the room and **can reach you before `full_state`**.
- **Consequence:** if you blindly overwrite state on `full_state`, you clobber
  newer data with an older baseline.
- **Fix:** the reducer is idempotent and **timestamp-guarded** (§5). Apply
  `full_state` events through the same `applyEvent`; older events simply don't
  regress newer fields. Never do `state = snapshot`.

### 6.2 `full_state` and live streams overlap (duplicates)
The same event may appear both in the connect snapshot and as a live update.
- **Fix:** dedupe by `stepId` (upsert) and guard scalar fields by `timestamp`.
  Applying the same event twice must be a no-op. Never `push` events into an array.

### 6.3 Reconnection replays `full_state` — and you MUST re-merge it
socket.io auto-reconnects. On every reconnect the server treats it as a **new
connection** and re-sends `full_state`. A **browser refresh** is a fresh page +
fresh socket → same path: a new `full_state` arrives on connect.
- **Consequence:** events emitted **while you were disconnected** are not
  delivered as live updates — the reconnect `full_state` carries the current
  status (DB-authoritative), but its `events` may be empty (§6.5).
- **Fix:** always handle `full_state` on **every** connect, not just the first.
  Do **not** reset your store on reconnect; merge the snapshot in. Track a
  `connected` flag for UI, but keep the data. If you ever suspect the connect-time
  catch-up was missed, `socket.emit("sync")` to force a fresh `full_state`.

### 6.4 The snapshot event log is bounded to the last 200 events
`HarnessSnapshot.events` keeps only the most recent 200. A long run that
disconnected early may have dropped the earliest `node_start`s from the snapshot.
- **Consequence:** after a long-disconnect reconnect you might see a `node_end`
  for a step whose `node_start` you never got.
- **Fix:** treat any event as an **upsert** — a `node_end` with no prior
  `node_start` still creates the step (status `completed`). Don't assume start
  precedes end.

### 6.5 `full_state` covers in-flight runs; history may be status-only
`full_state` includes the user's **in-flight** conversations — those with a live
`activeRunId` (status `running` or `awaiting_hitl`). The `runStatus` is always
correct (read from the DB). But the event **history** lives in Redis with a 60s
post-terminal TTL, so:
- An `awaiting_hitl` conversation you reconnect to >60s later still arrives, with
  the right `runStatus` but **`events: []`** — render the status; don't expect the
  step history.
- A **completed** run (its `activeRunId` is cleared) is **not** in `full_state`
  at all.
- **Fix:** apply `runStatus` from every entry regardless of `events`. Once you've
  marked a run terminal, **persist its final state client-side** (or fetch detail
  from the REST API). Absence from a later `full_state` means "finished / no
  longer in-flight", never "delete it".

### 6.6 Multiple concurrent runs interleave on one socket
A user can trigger several conversations at once; their updates arrive
interleaved on the same connection.
- **Fix:** **always** route by `msg.conversationId` (updates) /
  `snapshot.conversationId` (full_state). Never assume "the current run". A UI
  bound to a single active run will corrupt when a second one emits.

### 6.7 `stepId` is optional
`status` events (including the terminal one) and `agent_status` events often have
**no `stepId`**.
- **Fix:** only do the step upsert when `event.stepId` is present. Drive overall
  status from `runStatus`/`phase`, which are always present.

### 6.8 `payload` is optional
`node_start` and `status` events usually carry **no payload**. Only read
`event.payload` after narrowing on `event.payload?.node`.
- **Fix:** never assume `payload` exists; guard every access.

### 6.9 `tasksByLevel` must be replaced, not merged
Each orchestrator/supervisor/taskGenerator event carries the **entire** recomputed
DAG. Merging arrays produces duplicate/stale tasks.
- **Fix:** `next.tasksByLevel = payload.data.tasksByLevel` (full replace). Task
  status changes come through as a **new full DAG**, not per-task deltas.

### 6.10 HITL is terminal-but-resumable
`awaiting_hitl` ends the current run pass. The run resumes later as a **new job**
(and may reuse the run id) — you'll receive fresh events again after the user
submits their decision via the REST API, but **don't assume the first one is
`router`** — `approve`/`review` skip ahead (§4.1); `reject` produces no
`node_start` at all, only a terminal `status`.
- **Fix:** render the `humanInTheLoop` payload (reason + `markdownPlan`) and
  treat `awaiting_hitl` as "paused, waiting on user", not "done". Clear the
  `hitl` block when new non-HITL events arrive. Gate your "resumed" transition
  on `runStatus` changing, not on seeing a specific node start.

### 6.11 React StrictMode / effect cleanup double-connects
In dev, `useEffect` runs twice; without cleanup you open two sockets and get
duplicate events.
- **Fix:** create the socket in `useEffect` and **`socket.disconnect()` in the
  cleanup**. One socket per mounted provider. See §7.

### 6.12 Stale closures in event handlers
Registering `socket.on("conversation", …)` with a handler that closes over state
captures a stale snapshot.
- **Fix:** update state via a **functional reducer** (`setState(prev => …)`) or
  `useReducer`, so the handler never reads stale `state` directly. Register the
  listener **once**; don't re-bind on every render.

### 6.13 Ordering guarantee is per-connection only
Within one connection socket.io preserves emit order. Across a
disconnect/reconnect that guarantee is gone (see 6.3/6.4).
- **Fix:** the `timestamp` guard in the reducer is the ordering source of truth,
  not arrival order.

### 6.14 `warning` events are noise unless you render them deliberately
A `phase: "warning"` event does not mean anything failed — the agent named in
`node` is retrying a bad response and will very likely recover on its own
within a second or two (§4). If you log every socket event to a raw feed,
warnings will show up there; that's fine. But don't:
- treat it as a step failure (the step's `StepUIState.status` stays `"running"`;
  don't flip it to anything error-like),
- toast/alert on every one (a model can legitimately retry 2-3 times on a
  single step under normal load — that's not exceptional),
- leave it showing forever if the step actually did fail — that's what the
  step's `node_end` never arriving, plus the run's own terminal `failed`
  status, is for. `warning` is "still working on it", not "here's the error".
- **Fix:** render it as a small transient inline note next to the step (e.g.
  "retrying…"), cleared by the reducer's own logic once `node_end` arrives for
  the same node (§5 step 2). Most users will never see one — it only shows up
  when a step needed more than one attempt.

---

## 7. Reference React hook (shape, not a drop-in)

```tsx
function useHarnessSocket() {
  const [conversations, dispatch] = useReducer(reducer, {} as Record<string, ConversationUIState>);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(window.location.origin, {
      path: "/_/admin/ai/socket.io/",
      withCredentials: true,
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false)); // keep data; just flag UI
    socket.on("connect_error", (err) => {
      if (err.message === "unauthorized") {/* redirect to login */}
    });

    // ONE listener, functional dispatch → no stale closures
    socket.on("conversation", (msg: HarnessSocketMessage) => {
      dispatch({ type: "socket", msg }); // reducer fans full_state/update through applyEvent
    });

    return () => { socket.disconnect(); }; // StrictMode-safe
  }, []); // empty deps: connect once

  return { conversations, connected };
}
```

The `reducer` handles `msg.type === "full_state"` by merging every snapshot's
events, and `msg.type === "update"` by applying the single event — both through
the idempotent, timestamp-guarded `applyEvent` from §5.

---

## 8. Checklist before shipping

- [ ] `withCredentials: true` and correct `path`.
- [ ] `connect_error: "unauthorized"` routes to login.
- [ ] `full_state` handled on **every** connect (incl. reconnects), merged not replaced.
- [ ] All state keyed by `conversationId`; multiple runs supported.
- [ ] Reducer is idempotent and timestamp-guarded (safe to replay).
- [ ] Steps upserted by `stepId`; missing `stepId`/`payload` guarded.
- [ ] `tasksByLevel` replaced wholesale.
- [ ] Terminal runs persisted client-side (survive the 60s snapshot eviction).
- [ ] Socket disconnected on unmount; single listener; functional dispatch.
- [ ] `warning` events rendered as a transient per-step notice, not an error state (§6.14).
- [ ] "Resumed" UI transition keyed off `runStatus`, not off a specific node starting (§4.1, §6.10).
```
