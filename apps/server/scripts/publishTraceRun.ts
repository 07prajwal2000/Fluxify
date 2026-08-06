/**
 * Publishes one recorded run at `FLUXIFY_TRACES`, standing in for the request
 * worker until it produces real ones (#195 session 1). This is how the telemetry
 * worker is exercised end to end:
 *
 *   bun --env-file=.env apps/server/deployments/telemetryWorker.ts
 *   bun --env-file=.env apps/server/scripts/publishTraceRun.ts
 *
 * `E2E_PROJECT` targets another project (a project with no telemetry setting
 * should produce no export at all); `E2E_RUN_ID` re-publishes a known run, which
 * must still yield exactly one trace in the backend.
 */
import { connect, StringCodec } from "nats";
import { traceRunSubject } from "../src/modules/telemetry/subjects";
import type { TraceRunPayload } from "@fluxify/common/otlp";

const PROJECT = process.env.E2E_PROJECT ?? "019fa9f4-352e-786c-9d75-7e95f74898bc";
const PERF = 5_000;
const runId = process.env.E2E_RUN_ID ?? crypto.randomUUID();
const now = Date.now();

const run: TraceRunPayload = {
	runId,
	projectId: PROJECT,
	routeId: "route-e2e",
	routeVersion: new Date(now).toISOString(),
	method: "POST",
	path: "/e2e-check",
	startedAtWallMs: now,
	perfOrigin: PERF,
	endedAt: PERF + 120,
	outcome: "failure",
	statusCode: 500,
	spans: [
		{ seq: 0, blockId: "entry", blockType: "entrypoint", startedAt: PERF + 1, endedAt: PERF + 3, outcome: "success", input: { id: 42 }, output: { id: 42 } },
		{ seq: 1, blockId: "inner", blockType: "jsrunner", parentSeq: 2, customBlockId: "cb-e2e", startedAt: PERF + 12, endedAt: PERF + 18, outcome: "success" },
		{ seq: 2, blockId: "invoke", blockType: "custom_block", startedAt: PERF + 10, endedAt: PERF + 20, outcome: "success" },
		{ seq: 3, blockId: "explode", blockType: "jsrunner", startedAt: PERF + 30, endedAt: PERF + 34, outcome: "failure", error: "boom" },
	],
};

const nc = await connect({ servers: process.env.NATS_URL, token: process.env.NATS_TOKEN });
const js = nc.jetstream();
const subject = traceRunSubject(PROJECT, runId);
const ack = await js.publish(subject, StringCodec().encode(JSON.stringify(run)), {
	msgID: runId,
});
console.log(`published ${subject} seq=${ack.seq} runId=${runId}`);
await nc.drain();
