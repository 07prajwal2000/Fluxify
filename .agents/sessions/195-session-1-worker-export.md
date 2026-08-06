# Session 1 — Trace seam + worker-side export (#195, part of #194)

Goal: a traced route emits complete, ordered, nested spans out of the execution
process, through the supervisor, onto a JetStream stream. Nothing consumes them
yet. An untraced route is byte-identical to today.

## Verified facts (checked, do not re-derive)

- Execution isolation is a **child process**, not a worker thread.
  `compiledWorker.ts` (supervisor) owns NATS + `MASTER_ENCRYPTION_KEY`;
  `executionProcess.ts:30` clears `process.env`. IPC is Bun `process.send` /
  `ipc:` callback. Types in `requestRouter/threadTypes.ts`.
- Seam from #193 lives in `packages/blocks/baseBlock.ts`: `BlockTrace.recordSpan(span)`,
  `BlockTraceSpan = { blockId, blockType, input, output, outcome, branch?, error? }`.
  Compiler wires it in `packages/blocks/compiler.ts` (`recordSpan()` inside
  `emitBlock`), zero-cost when `ctx.trace` is unset.
  **Gap: no timestamps, no sequence, no parent.**
- `span.blockId` is `blocks.id` (schema.ts:263) which is the React Flow node id.
  Portal overlay is a direct join, no mapping table.
- Custom blocks share the caller's `ctx` (`builtin/customBlock.ts:70`), so inner
  spans currently land flat with no nesting marker.
- `RouteExecutionObserver` (`requestRouter/service.ts:50`, impl
  `executionProcess.ts:104`) already produces exactly one id per route execution
  with a start hook + finish callback, and `dispatch` builds the `Context` in the
  same function. **This is the run lifecycle — reuse it, don't invent one.**
- Supervisor watchdog kill site: `compiledWorker.ts:201` (`TODO(#195)`).
- Compile-pipeline stream naming pattern: `modules/compiler/subjects.ts`.

## Decisions (settled — do not re-litigate)

- **Two independent flags**, both on `routes` and `RouteArtifact`:
  - `tracingEnabled` — spans exported to the user's OTEL system; we store nothing.
  - `recordExecution` — debug recording for the portal; stored in PG. Expensive.
  Shared buffer/IPC/JetStream transport; only the sink differs.
- `routeVersion: string` on `RouteArtifact`, carried on the **run header, not per
  span**. Versioned route graphs are coming; the portal resolves the graph against
  this. (Supersedes the earlier `compiledAt`-on-run idea — drop that.)
- Ids: `runId` = the id `RouteExecutionObserver` already mints. Spans get integer
  `seq` + `parentSeq`. **No per-span UUIDs** — the graph is a strict tree executed
  sequentially in one process.
- Async custom blocks (`invokeCustomBlockAsync`) **do not nest** — they outlive the
  request. Parent records a single dispatch span; the async run is its own root run
  with `parentRunId`.
- Payload caps: 4 KiB/span, 64 KiB/run, `truncated` flag. **No redactor** —
  no field classification exists in this codebase; document that traces carry
  request data.
- **No sampling.** The route flags are the sampler.
- Logs are **not** embedded in spans. Log blocks are blocks, so their span already
  carries the message. `console.log` inside JS blocks is out of scope.
- Metrics are **pushed** as periodic `worker-stats` on the same stream, keyed by
  worker id (`HOSTNAME`, else boot-time random, stamped supervisor-side).
  Round-robin scraping through the LB is wrong — rejected. Health-endpoint
  counters are for `kubectl exec` debugging only. No Prometheus, no new backend.

## Work, in order

1. **Flags + version through the pipeline.** DONE. `routes.tracing_enabled`,
   `routes.record_execution` (migration `0050`) -> `RouteArtifact`
   (+ `routeVersion`, = `compiledAt` until versioning lands) -> compiler ->
   `routeDefinition` -> `HttpRoute` -> `dispatch`.

   `HttpRouteParser` used to copy a hand-listed subset of route fields into the
   `<ID>` leaf and again into the `getRouteId` return; the leaf now carries the
   whole `HttpRoute` (`packages/lib/routing/parser.ts`). Smaller, and new route
   fields reach `dispatch` for free.

   **Portal toggle deferred, on purpose.** There is no route settings UI in
   `apps/portal` at all — even `timeoutSeconds` is hardcoded at creation
   (`routes.tsx:177`). Building a settings panel to host two switches is a
   different task; the flags are settable over `PATCH /routes/:id` today, and
   the toggles belong beside the trace viewer when that lands.
2. **Seam extension** (`packages/blocks/`): `performance.now()` at block-function
   entry/exit into the span. Push/pop parent scope in `invokeCustomBlock`.
   Codegen stays dumb — seq, parent, truncation all belong to the trace impl.
3. **Trace object + bounded buffer** in the execution process. Attach `ctx.trace`
   at the `RouteExecutionObserver` start hook. Caps: spans/run, runs buffered,
   bytes/span, flush queue depth. Overflow drops the whole affected trace and
   bumps a counter — never delays the request.

   **The run header must carry both `Date.now()` and the `performance.now()`
   origin taken at the same instant.** Span times are `performance.now()`
   readings, meaningless off-box; the telemetry worker reconstructs wall clock as
   `wallStart + (spanT − perfOrigin)`. Without both, every exported span is
   timestamped wrong. (Found while scoping session 2.)
4. **IPC batching** — new `ExecutionEvent` variants in `threadTypes.ts`. Flush
   interval must be well under the route timeout: the watchdog `kill()`s the child
   and anything buffered dies with it.
5. **Supervisor publish** — `FLUXIFY_TRACES` stream, own subject, separate from
   `fluxify_artifacts`. Explicit retention, `max_age` 7d, `max_bytes`.
   `Nats-Msg-Id` per batch for JetStream dedup. Publish failure or NATS down drops
   telemetry only. Emit a kill event from `compiledWorker.ts:201`.
6. **Worker stats** — periodic `worker-stats` publish + counters on the health
   endpoint. Publishing is supervisor-side **by design**: the failure worth
   observing is a wedged execution process (sync CPU loop, blocked event loop),
   and a child that pushed its own metrics would push nothing exactly then.
   The supervisor is never blocked by user code.

   Separate the two provenances in the payload:
   - *Supervisor-observed* (always fresh): child alive, restarts, kills,
     heartbeat age, and the watchdog's in-flight map.
   - *Child-reported* (stale during a wedge): spans buffered/dropped/flushed.
     **Stamp each with the age of the IPC message it came from** — a stale
     counter beside a growing heartbeat age is the "why is this request
     pending" signal.

   Surface `ExecutionWatchdog.active` (`executionWatchdog.ts:22`:
   requestId, routeId, timeoutMs, startedAt) plus `stalledForMs`. That
   distinguishes a healthy async request outliving its timeout (still
   heartbeating) from a synchronous CPU loop (heartbeat stalled) — which
   per-child CPU% cannot. Do not chase CPU%.

   **Decouple in-flight tracking from the timeout policy.** Today
   `setEnabled(false)` clears `active` and stops heartbeats
   (`executionWatchdog.ts:32`), so the in-flight view would exist only for
   projects with experimental timeouts on. Tracking start/finish is nearly
   free; the visibility is worth more than the flag.

## Constraints

- Nothing in the execution process may hold a NATS/DB connection or a credential.
- Error-handler graphs keep executing after a failure: run outcome comes from the
  final response, not the first failing span.
- `WORKER_PROJECT_ID` can be `*` — `projectId` comes from the matched route.
- Tests ship with the code. Overflow and drop paths get one runnable check each.

## Done when

- Traced route produces ordered spans with durations and custom-block nesting on
  the stream.
- Untraced route shows no measurable difference vs. the pre-tracing benchmark.
- Sustained traced load: overflow shows as a dropped-span counter, never as
  latency or a failed request.
- NATS down: traffic serving completely unaffected; artifact delivery undelayed.
