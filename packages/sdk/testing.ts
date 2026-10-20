// `@fluxify/sdk/testing`: unit-test one block with no Fluxify runtime. The
// rules it runs by are `@fluxify/sdk/runtime`'s, the same code a worker runs.
export type { FailedBranch } from "./src/runtime/contract.js";
export type { SpanRecord } from "./src/runtime/ctx.js";
export {
	type LogEntry,
	manualTimer,
	memoryKv,
	memoryQueue,
	recordingLogger,
	type SentMessage,
	type TestPool,
	testPool,
} from "./src/testing/fakes.js";
export {
	type BranchStub,
	type HandleCall,
	type HandleStubs,
	type InputParams,
	type RunBlockOptions,
	type RunBlockResult,
	runBlock,
	type TestContext,
} from "./src/testing/runBlock.js";
