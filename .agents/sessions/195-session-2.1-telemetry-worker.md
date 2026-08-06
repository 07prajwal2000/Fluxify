# Session 2.1 — Telemetry worker + integration wiring (#195)

Depends on session 1 (`195-session-1-worker-export.md`, steps 3–6 unbuilt) and
session 2 (`195-session-2-otel-sdk.md`). Read both first; facts are not repeated.

Scope: the deployment that drains `FLUXIFY_TRACES` and calls session 2's
`exportRun()`, plus wiring the OTEL integration into the app so a project has a
destination at all.

**PG persistence stays deferred** — the portal recording view waits for route
versioning, so `routeVersion` on the run header is the only forward compatibility
this session preserves.

## Verified facts (checked in source — do not re-derive)

- `observabilityVariantSchema` (`apps/server/src/api/v1/integrations/schemas.ts:25`)
  is `["Open Telemetry Logs", "Loki"]`, matched by **literal string** in
  `integrationsLoader.ts:148`. Rows store the string in `integrations.variant`.
- **There is no project-level telemetry setting.** The observability integration
  is selected **per log block** — `cloudLogsBlockSchema.connection` holds an
  integration id (`packages/blocks/builtin/log/cloudLogs.ts:10`), resolved per
  call via `IntegrationFactory` (`loaders/integrationFactory.ts:42`).
  `projectsEntity` (`schema.ts:35`) has only `id/name/hidden/timestamps`. This
  must be **built**, not linked.
- `OpenTelemetryLogs` appends `/v1/logs` to `baseUrl`
  (`packages/adapters/observability/openTelemetryLogs.ts:106`) and hardcodes an
  OpenObserve-specific `stream-name: logs_${projectId}` header (`:113`).
- `cfg:` credential refs are dereferenced by each adapter's
  `ExtractConnectionInfo` at load time (`integrationsLoader.ts:150`). The cache
  stamps ownership with `OWNER_KEY = "__projectId"`; `ownsIntegration` /
  `scopeToProject` (`integrationsLoader.ts:44`) are the cross-project guard.
  **Reuse them — every lookup goes through one of the two.**
- Existing deployments: `compiledWorker.ts`, `standalone.ts`, `worker.ts`.

## Decisions

### One integration, three signals

- **Rename the variant to `"Open Telemetry"`, keep `"Open Telemetry Logs"` as an
  accepted alias.** Existing rows must not break and the loader matches by
  literal string.
- One base URL, standard OTLP paths, one credential set. **Three booleans on one
  config** — `sendLogs`, `sendTraces`, `sendMetrics` — not three integrations. A
  user with a traces backend and no metrics backend is normal.
- `stream-name` becomes **per-signal** (`logs_`/`traces_`/`metrics_`). It is
  OpenObserve-specific and harmless elsewhere.

### Project-level destination

- New `projects.telemetryIntegrationId` column. Trace export is per-run, not
  per-block, and this worker resolves it from `projectId` alone — the log block's
  `connection` field cannot serve that.
- **Route-level destination rejected.** Nobody splits route A to Honeycomb and
  route B to Grafana. The route already carries the on/off switch in
  `tracingEnabled`.
- It stays **out of the `project-config` artifact**: this worker is admin-plane
  with DB access, so OTLP credentials never reach the data plane — the constraint
  session 1 already committed to.

### No destination → no export, and no trace either

- Route predicate becomes:

  ```
  trace this run if (tracingEnabled && hasTraceDestination) || recordExecution
  ```

- `hasTraceDestination` is a **plain boolean stamped into the `project-config`
  artifact** by the compiler — no URL, no credentials, just the bit. The
  execution process then never allocates the trace: zero hot-path cost, no wasted
  publish for a misconfigured project.
- This worker **re-checks on consume and drops** — config can change between
  compile and consume, and a dropped export must never fail an ack.
- `recordExecution` is independent: recording needs no integration.

### Consumer

- **One run = one message**, so a trace is never stitched across messages.
- **Ack when spans are queued to the processor, not after the network export.**
  Otherwise ack latency is a user's slow OTLP endpoint and the consumer stalls
  behind it. A crash loses queued spans — correct trade for telemetry.
- Delivery is at-least-once. Session 2's deterministic ids already make a
  redelivered run idempotent in the backend; `Nats-Msg-Id` dedup is the cheap
  first line. Once PG lands, `PRIMARY KEY (run_id, seq)` + `onConflictDoNothing`
  carries it and doubles as the `(runId, seq)` index — do not add a second one.
- **Cap live providers (LRU, `shutdown()` on eviction).** One
  `BatchSpanProcessor` and socket pool per destination leaks on a many-project
  instance.

## Work, in order

1. **Integration rework.** Variant rename + alias, per-signal booleans, per-signal
   path and `stream-name`. `TestConnection` probes the configured signals.
   Touches `integrations/schemas.ts`, `integrationsLoader.ts`,
   `integrationFactory.ts`, `packages/adapters/observability/openTelemetryLogs.ts`
   (becomes the shared OTEL adapter), portal integration UI.
2. **`projects.telemetryIntegrationId`** column + migration + project settings UI.
3. **`hasTraceDestination`** into the `project-config` artifact from the compiler.
4. **`apps/server/deployments/telemetryWorker.ts`**, sibling to
   `compiledWorker.ts`. Admin-plane: may hold NATS and DB connections, runs **no
   user code**.
5. **Durable pull consumer** on `FLUXIFY_TRACES`, ack per the decision above.
6. **Export** via session 2's `exportRun()`, one provider per destination.
7. **Retention.** JetStream `max_age` 7d covers the stream. When PG lands:
   `DELETE FROM trace_runs WHERE started_at < now() - 7d` on a `setInterval` here,
   cascading to spans. No cron infra.

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
- UI: `apps/portal` only. `apps/web` is legacy — leave it.

## Constraints

- Telemetry volume must never pressure artifact delivery (#191) — separate stream,
  separate consumer, explicit limits.
- This worker down or NATS unavailable: traffic serving completely unaffected.
  Degrade to dropping spans, never to stalling or failing requests.
- Cross-project credential leakage is the live risk in the shared integration
  cache. Every lookup goes through `ownsIntegration`/`scopeToProject`.

## Done when

- Spans from a traced route reach the project's OTEL destination.
- A project with no telemetry integration records no trace at all — verify the
  execution process never allocates one.
- Consumer restart neither loses nor replays the stream.
- Killing this deployment has zero effect on request serving.
