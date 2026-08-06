# Session 2 — OTEL traces + metrics SDK and push mechanism (#195)

Scope: **the export layer only.** Provider factories, the translation from a
Fluxify run to OTEL spans, the metrics push, and tests that prove it against a
live Jaeger and Prometheus. No NATS, no telemetry worker, no project settings —
that is session 2.1.

This session defines the **wire contract** (`TraceRunPayload`) that session 1
publishes and session 2.1 consumes. Defining it here is the point: session 1 step
3 currently has no target shape.

## Verified facts (checked in node_modules / source — do not re-derive)

- **Do not write a custom OTLP client.** In `@opentelemetry/api@1.9.1` /
  `sdk-trace-base@1.30.1`:
  - `SpanOptions.startTime?: TimeInput`, `Span.end(endTime?: TimeInput)` —
    replayed historical spans backdate correctly. The only thing that could have
    forced a hand-rolled client.
  - `SpanOptions.links` — the primitive for detached async custom-block runs.
  - `TracerConfig.idGenerator?: IdGenerator` is per-provider. `Tracer.js:58,65`:
    `generateSpanId()` runs per span, `generateTraceId()` only when there is no
    valid parent. A stateful generator set immediately before each `startSpan`
    therefore controls both — see the deterministic-ids decision.
  - `TracerConfig.spanLimits.attributeValueLengthLimit` is a free second
    truncation net under session 1's 4 KiB/span cap.
- **`@fluxify/common/index.ts` deliberately does not re-export `./tracing`** —
  `@opentelemetry/instrumentation` eagerly loads `node:v8` and breaks every
  importer under Bun. **Therefore: use `BasicTracerProvider` from
  `sdk-trace-base`, never `NodeTracerProvider` from `sdk-trace-node`**, and ship
  the new code behind its own subpath export.
- **Do NOT reuse `initializeTracing`** (`packages/common/tracing/instrumentation.ts`)
  — one-endpoint global singleton (`isInitialized`, `provider.register()`,
  `global.__tracerProvider`, process SIGINT/SIGTERM hooks). We need N
  *unregistered* providers.
- **Do reuse the shape of `createOtlpLoggerProvider`**
  (`packages/common/logging/otlp/logs.ts:15`): a factory returning a provider the
  caller holds, no global registration. The trace and meter twins mirror it.
- **Do NOT reuse `FluxifyOtelTracer`** (`apps/ai-gateway/.../otel-tracer.ts`) — a
  LangChain callback handler for live in-process spans, wrong shape. Steal two
  ideas: `safeStringify`, and its non-`Error` handling (`otel-tracer.ts:70`) —
  `recordException` keeps nothing from a plain object.
- Dependencies: `sdk-metrics@1.30.1` is present transitively but **not declared**;
  `exporter-metrics-otlp-http` is **not installed**. Both must be added to
  `@fluxify/common`.
- Local stack (`docker-compose.yml`): Jaeger OTLP HTTP on `4318`; Prometheus on
  `9090` with `--web.enable-otlp-receiver` and `scrape_configs: []` — **push
  only**, receiver at `/api/v1/otlp/v1/metrics`.

### Two Bun quirks, both hit for real and both fixed

1. **Every OTLP flush reports a spurious failure.**
   `otlp-exporter-base/.../http-transport-utils.js:83` registers
   `req.on('close', …)` **unconditionally** and reports it as
   `Error("Request timed out")`. Under Bun `close` fires on successful requests
   too, so `onDone` gets a success *and* a failure. The telemetry does arrive —
   verified by reading the trace back out of Jaeger. Not exporter-specific:
   proto and http/JSON behave identically. `tracing/instrumentation.ts:110`
   already swallows the same string for the global provider.
2. **The rejection is an `Array` of errors, not an error.**
   `BasicTracerProvider.forceFlush` aggregates its processors' failures, so a
   guard written as `error instanceof Error` silently never fires and the quirk
   sails through. Cost an extra debugging round; `otlp/flush.ts` unwraps arrays
   and has a regression test for exactly this shape.

   Callers use `flushTelemetry` / `shutdownTelemetry` from `@fluxify/common/otlp`
   — never `provider.forceFlush()` directly, or session 2.1 logs an error on
   every successful export.

## Decisions

- **Deterministic ids, derived from `runId`/`seq`.** `traceId =
  sha256(runId)[0:32]`, `spanId = sha256(runId:seq)[0:16]`. Buys three things at
  once: redelivery is idempotent in the backend rather than a duplicate trace
  with fresh ids; a detached async run can build a real `links[]` SpanContext to
  its parent without knowing export-time state; and a trace is addressable from a
  `runId` alone, which the portal viewer will want. Implemented as a stateful
  `IdGenerator` set before each `startSpan` — safe because the export loop is
  synchronous per span.
- **`PeriodicExportingMetricReader` is the push mechanism.** Prometheus is
  configured as an OTLP receiver with no scrape config, so pull is not an option
  here and pull through a load balancer was already rejected.
- **Base URL + standard signal paths.** `${baseUrl}/v1/traces`,
  `${baseUrl}/v1/metrics`, `${baseUrl}/v1/logs`. Jaeger takes
  `http://localhost:4318`; Prometheus takes `http://localhost:9090/api/v1/otlp`.
  One convention covers both.
- **The caller owns provider lifetime.** These factories never register globally
  and never install process hooks. Session 2.1 holds them in an LRU and calls
  `shutdown()` on eviction.

## Wire contract

`TraceRunPayload` — one run, one message. Session 1 produces it, session 2.1
hands it to `exportRun()`.

Both `startedAtWallMs` (`Date.now()`) and `perfOrigin` (`performance.now()` at the
same instant) are required: span times are monotonic readings, meaningless
off-box. Wall clock is `startedAtWallMs + (spanT − perfOrigin)`. Without the pair,
every exported span is timestamped wrong.

## Span mapping

| Fluxify | OTEL |
|---|---|
| run | root span, name `METHOD /path`; attrs project, `routeId`, `routeVersion`, `runId`, outcome, `truncated`, `droppedSpans` |
| span | child span, name = `blockType`; attrs `fluxify.block.id`, `fluxify.block.type`, `fluxify.branch`, `fluxify.custom_block.id`, stringified input/output |
| `parentSeq` | parent via `trace.setSpan(ROOT_CONTEXT, spansBySeq.get(parentSeq))` — custom-block nesting falls out for free |
| `outcome: "failure"` + `error` | `recordException` (rebuild an `Error` if it isn't one) + `setStatus({ code: SpanStatusCode.ERROR })` |
| detached async run | own root span + `links: [{ context: derived parent SpanContext }]` |

## Work

1. `packages/common/otlp/` — `traces.ts` (`createOtlpTracerProvider`, `exportRun`,
   deterministic `IdGenerator`), `metrics.ts` (`createOtlpMeterProvider`,
   route instruments), `types.ts` (`TraceRunPayload`). Subpath export
   `@fluxify/common/otlp`, kept out of the root barrel.
2. Declare `@opentelemetry/sdk-metrics` and add
   `@opentelemetry/exporter-metrics-otlp-http`.
3. Tests. Unit: mapping, nesting, timestamp reconstruction, deterministic ids,
   error spans — against `InMemorySpanExporter`, no network. Integration: opt-in
   via env against live Jaeger/Prometheus, skipped by default so CI stays offline.

## Done when

- A `TraceRunPayload` round-trips into Jaeger as one trace: correct wall-clock
  times, blocks nested under the run, custom-block spans under their invoking
  block, failing block carrying an exception.
- The same payload exported twice produces one trace, not two.
- Route metrics land in Prometheus via OTLP push and are queryable.
- Nothing in this package registers a global provider or a process hook.

## Not in this session

Telemetry worker, NATS consumer, integration variant unification, project-level
destination, `hasTraceDestination` — session 2.1. Worker fleet registry —
session 3.
