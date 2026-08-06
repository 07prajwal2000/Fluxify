# Session 2 — Telemetry worker: stream consumer, OTEL fan-out, stats (#195)

Depends on session 1 (`195-session-1-worker-export.md`) — read its Verified facts
and Decisions first; they are not repeated here.

Goal: drain `FLUXIFY_TRACES` in a dedicated admin-plane deployment, export to the
user's OTEL destination, and aggregate worker stats. **PG persistence is
deliberately deferred** — the portal recording view waits for route versioning,
so `routeVersion` on the run header is the only forward compatibility this
session needs to preserve.

## New deployment

`apps/server/deployments/telemetryWorker.ts`, sibling to `compiledWorker.ts`.
Admin-plane: it may hold NATS and DB connections and it runs **no user code**.
Durable, explicit-ack consumer — a restart must neither lose the stream nor
replay it whole.

## Work, in order

1. **Consumer.** Durable pull consumer on `FLUXIFY_TRACES`. Ack after the batch
   is handled. Delivery is at-least-once: dedup on `Nats-Msg-Id` (published in
   session 1); once PG lands, `PRIMARY KEY (run_id, seq)` +
   `onConflictDoNothing` carries the idempotency and doubles as the
   `(runId, seq)` index — do not add a second one.
2. **OTEL export**, per project, for runs whose route had `tracingEnabled`.
   One batched exporter per project, not per request — this replaces the
   per-request exporter churn in #192. User OTLP credentials resolve here and
   **never** enter an execution process. Config comes from the project's
   observability integration.
3. **Stats aggregation.** Consume `worker-stats`, keyed by worker id. Expose
   dropped spans, publish failures, consumer lag and stream depth. Aggregate
   in-process into a short-window ring buffer and serve on this deployment's
   health endpoint; the admin panel's worker-health view reads from here.

   **No Prometheus — in cloud either.** A TSDB earns its keep for PromQL,
   alerting and weeks of history; a worker-health panel needs current state and a
   short window. A cloud-only metrics path would also make one screen into two
   code paths. If cloud later wants long retention, aggregate rows go to PG
   beside the traces — same shape, no new component.

   **Worker registry — push has no liveness signal.** Scraping fails loudly when
   a target vanishes; push just goes quiet, and quiet is indistinguishable from
   "never existed". Workers announce on boot and heartbeat in the stats message;
   the aggregator marks a worker stale after N missed intervals. Without this a
   hung worker looks exactly like a scaled-down one.
4. **Retention.** JetStream `max_age` 7d does the stream side. When PG lands:
   `DELETE FROM trace_runs WHERE started_at < now() - 7d` on a `setInterval`
   in this worker, cascading to spans. No cron infra.

## Deferred to the versioning work (shape only, do not build)

- `trace_runs`: project, route, `routeVersion`, start/end, outcome,
  dropped/truncated state, `parentRunId` for async custom-block runs.
- `trace_spans`: run, `seq`, `parentSeq`, `blockId`, `blockType`, nullable
  `customBlockId` (spans inside a custom block carry that graph's node ids —
  overlaid on the route canvas they highlight nothing), timestamps,
  outcome/error, truncated payload.
- Indexes: `(projectId, startedAt desc)` on runs; PK `(runId, seq)` on spans.
- Runs with `endedAt IS NULL` older than the route timeout render as
  "incomplete". **No sweeper job, no `abandoned` status writes.**
- API: project-scoped run list + single trace detail, ACL enforced.
- UI: `apps/portal` only. `apps/web` is the legacy app — leave it.

## Constraints

- Telemetry volume must never pressure artifact delivery (#191) — separate stream,
  separate consumer, explicit limits.
- Telemetry worker down or NATS unavailable: traffic serving completely
  unaffected. Degrade to dropping spans, never to stalling or failing requests.

## Done when

- Spans published by a traced route reach the user's OTEL destination.
- Consumer restart neither loses nor replays the stream.
- Stats visible per worker id behind the LB.
- Killing this deployment has zero effect on request serving.
