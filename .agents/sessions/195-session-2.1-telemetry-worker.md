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
- **Session 2's export layer round-trips against a live OpenObserve** —
  `http://localhost:5080/api/default` + `Authorization: Basic <b64>`, all three
  signals, no code change. Same base-URL-plus-standard-path convention as Jaeger
  and Prometheus, which is the evidence behind "one integration, three signals".
  Verified: 5 spans with custom-block nesting intact, correct wall clock,
  `span_status: ERROR` on the failing block, counter and histogram streams
  populated, a log record queried back by body.
  Query streams via `POST /api/default/_search?type=logs|traces|metrics`;
  OpenObserve stores span times in **nanoseconds** and `duration` in µs.

## Decisions

### One integration, three signals — **built**

- Variant renamed to `"Open Telemetry"`; `"Open Telemetry Logs"` is normalized on
  read by `normalizeObservabilityVariant`. The alias is deliberately **not** in
  `observabilityVariantSchema` — that enum is what the variant dropdown renders,
  so an alias inside it would appear as a second pickable entry for one thing.
- One base URL, standard OTLP paths, one credential set.
- **No `sendLogs`/`sendTraces`/`sendMetrics` booleans.** Per-signal opt-in is
  already expressed by which `settings.telemetry.*` key points at the
  integration; config booleans would be a second switch for the same thing, and
  two switches disagree eventually. The tags say what an endpoint *can* carry,
  the settings keys decide what it *does*.
- `getIntegrationTags` gives an OTEL integration all three tags. It previously
  returned `[]` for every one of them — the branch tested `"Open Observe"`, a
  string never present in the enum — and the client filters the picker on tags,
  so no OTEL integration was selectable at all.
- **Custom headers on both OTEL and Loki**, values `cfg:`-resolved like any other
  credential, for ingestors that key on an api key / tenant id / dataset rather
  than basic auth. User headers are spread *first* so they cannot clobber
  `Authorization` or `stream-name`. A `cfg:` ref that resolves to nothing is
  dropped rather than sent empty — an empty api key reads as a wrong credential
  at the far end, which is much harder to debug than an absent one.
- **Pre-existing bug fixed:** both observability adapters stripped `cfg:` with
  `substring(3)`, leaving a leading `:` on the key, so no `cfg:` reference in a
  Loki/OTEL `baseUrl` or credential had ever resolved. Every other adapter uses
  `slice(4)`.
- `stream-name` becomes **per-signal** (`logs_`/`traces_`), OpenObserve-specific
  and harmless elsewhere. **Not for metrics** — verified against a live
  OpenObserve: it ignores the header there and names the stream after the metric
  (`fluxify_route_requests`, `fluxify_route_duration_bucket`, …). Sending
  `metrics_${projectId}` would be a no-op that reads like a working knob, so the
  project dimension for metrics is the `fluxify.project.id` attribute, which
  `recordRun` already sets.

### Project-level destination

- **No new column — `project_settings` already is the store.** It is a key/value
  table and `settings.ai.loggerConnectionId` already holds an observability
  integration id (read at `requestRouter/service.ts:433`). That key was never
  AI-specific; it is the project's log destination, misfiled under
  `settings.ai.*`.
- Three keys, one per signal: `settings.telemetry.logsConnectionId`,
  `settings.telemetry.tracesConnectionId`, `settings.telemetry.metricsConnectionId`.
  The old key stays readable as the logs fallback and is no longer written.
- Per-signal rather than one telemetry key: a user with a traces backend and no
  metrics backend is normal, and nothing says all three live on one endpoint.
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

## Built (verified end to end against NATS + Postgres + OpenObserve)

- `src/modules/telemetry/{subjects,destinations,consumer}.ts`,
  `deployments/telemetryWorker.ts`, the three settings keys, and
  `scripts/publishTraceRun.ts` (stands in for the request worker until session 1
  lands — that script is the reproduction of everything below).
- A run published to `fluxify.trace.<projectId>.<runId>` reaches OpenObserve as
  one trace, 5 spans, custom-block nesting intact, `span_status: ERROR` on the
  failing block, and route metrics carrying `fluxify_project_id`.
- A project with no telemetry setting produces **no stream at all** — dropped,
  acked, logged at debug.
- Re-publishing the same `runId` yields one trace, not two.
- Worker stopped → run published → worker restarted: the backlog drains and
  nothing already exported replays.

**Nak policy deliberately differs from the compiler.** A malformed payload or a
missing destination fails identically on every redelivery, and the run has no
value once its route has moved on — so this consumer acks and drops where the
compiler naks. An uncompiled route is a broken product; a lost trace is not.

**Ordering trap for whoever adds a deployment next:** the worker needs
`drizzleInit()` *and* `initializeRedis()` before `loadIntegrations()` —
`getProjectSetting` reads through the redis cache, and without it every message
dies on `redisClient.get`. It is also not `--cwd`-safe: `.env` lives at the repo
root, so run it as `bun --env-file=.env apps/server/deployments/telemetryWorker.ts`
or NATS rejects the connection with an authorization violation.

## Work, in order

1. ~~Integration rework~~ — done. `TestConnection` is per-signal: it POSTs an
   empty OTLP batch (`{"resourceSpans":[]}` etc.) to `{baseUrl}/v1/{signal}`,
   which ingests nothing and answers 200 from a working receiver and 401 from one
   that rejects the credentials. It used to `GET {baseUrl}/settings` — an
   OpenObserve admin path that any other collector 404s, so a generic OTLP
   endpoint read as unreachable. The signal rides in as `?signal=` on
   `test-existing-connection`, defaulting to logs. Loki answers
   `Loki cannot receive traces` rather than probing a path it does not have.
2. ~~Project-level destination~~ — done as three `settings.telemetry.*` keys, with
   a Telemetry section on the portal project settings page: one
   `IntegrationSelector` per signal, each filtered by its tag so a Loki endpoint
   never appears under traces or metrics. The logs selector falls back to
   `settings.ai.loggerConnectionId` for display, so an existing project shows its
   destination without a migration.
   **Backfill note:** `integrations.tags` is a stored column written at
   create/update. Observability rows written before the `getIntegrationTags` fix
   carry `''` and will not appear in any filtered picker until re-saved —
   `update integrations set tags = 'logs,metrics,traces' where "group" =
   'observability' and variant like 'Open Telemetry%'` fixes an existing install.
3. **`hasTraceDestination`** — likely unnecessary. Project settings already reach
   the execution side via the artifact (`projectSettingsCache`), so the request
   worker can gate on `settings.telemetry.tracesConnectionId` being present
   without a new artifact field. Confirm when session 1 writes the predicate.
4. ~~`deployments/telemetryWorker.ts`~~ — done.
5. ~~Durable pull consumer on `FLUXIFY_TRACES`~~ — done.
6. ~~Export via `exportRun()`, one provider per destination~~ — done.
7. **Retention.** JetStream `max_age` **7h**, not days — a run is worth exporting
   for as long as it takes this worker to catch up after a restart and no longer,
   and the stream shares a NATS with compiled artifact delivery. Plus `max_bytes`
   512 MiB with `discard: old`, so telemetry volume can never pressure #191.
   Retention is `Limits`, not `Workqueue`: a work queue permits one consumer per
   subject and a second one (persisting runs to Postgres) is already planned.

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
